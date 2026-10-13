import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthSecret, isSessionUsableByPolicy } from "@/lib/auth-session-policy";
import { buildDefaultCanonicalVisibilityWhere } from "@/lib/jobs/visibility";
import { getTopPicksForUser } from "@/lib/queries/top-picks";
import { evaluateRequirements, parseRequirements, REQUIREMENTS_KEY } from "@/lib/top-picks/requirements";
import { issueWorkspaceToken, verifyWorkspaceToken } from "@/lib/applications/workspace-token";
import { AssistantError } from "@/lib/queries/application-assistant";
import { applicationContext, allowedExtension } from "@/lib/application-assistant";
import { normalizeContact } from "@/lib/profile";

async function profileRules(userId: string) {
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { authUserId: userId }, include: { preferences: { where: { key: REQUIREMENTS_KEY } } } });
  return { profile, requirements: parseRequirements(profile.preferences[0]?.value, normalizeContact(profile.contactJson).applicationAnswers?.values.relocation) };
}

export async function getAutoApplyWorkspace(userId: string, page = 1) {
  const { profile, requirements } = await profileRules(userId);
  const picks = await getTopPicksForUser(profile.id, { page, pageSize: 30 });
  const queued = await prisma.trackedApplication.findMany({ where: { userId, status: "PREPARING" }, orderBy: { updatedAt: "desc" }, take: 100,
    select: { id: true, canonicalJobId: true, company: true, roleTitle: true, roleUrl: true, updatedAt: true } });
  const rows = await prisma.jobCanonical.findMany({ where: { id: { in: picks.data.map(pick => pick.job.id) } }, select: {
    id: true, location: true, workMode: true, workModeConfidence: true, workModeStatus: true, employmentType: true, salaryMin: true, salaryMax: true, salaryCurrency: true, description: true,
  } });
  const connections = await prisma.extensionConnection.findMany({ where: { userId, connectedAt: { not: null }, expiresAt: { gt: new Date() } }, select: { clientId: true, session: true } });
  return {
    matches: picks.data.filter(pick => !pick.job.hasApplied && !queued.some(row => row.canonicalJobId === pick.job.id)).flatMap(pick => {
      const job = rows.find(row => row.id === pick.job.id);
      if (!job) return [];
      const checks = evaluateRequirements(requirements, job, profile.location ?? "");
      if (!checks.passed) return [];
      const context = applicationContext(pick.job.applyUrl, true);
      return [{ jobId: pick.job.id, title: pick.job.title, company: pick.job.company, location: pick.job.location,
        workMode: pick.job.workMode, score: pick.score, reasons: pick.matchReasons,
        concerns: [...new Set([...pick.concerns, ...checks.unknown.map(item => `${item} needs confirmation`)])],
        category: context && pick.job.eligibility?.submissionCategory !== "MANUAL_ONLY" ? "REVIEW_REQUIRED" as const : "MANUAL_ONLY" as const,
        automationReason: !context ? "The employer link cannot be identified as an application." : pick.job.eligibility?.submissionCategory === "MANUAL_ONLY" ? pick.job.eligibility.reasonDescription : "The live employer form must pass readiness checks before submission.",
        applyUrl: pick.job.applyUrl }];
    }),
    queued: queued.map(item => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
    requirements, homeLocation: profile.location ?? "", page: picks.page, hasNextPage: picks.hasNextPage,
    refreshing: picks.status.refreshing, stale: picks.status.stale, profileReady: picks.status.profileReady,
    profileMessage: picks.status.profileReadinessMessage,
    extensionIds: [...new Set(connections.filter(item => allowedExtension(item.clientId) && isSessionUsableByPolicy(item.session)).map(item => item.clientId))],
  };
}

async function eligibleJob(userId: string, jobId: string) {
  const { profile, requirements } = await profileRules(userId);
  const job = await prisma.jobCanonical.findFirst({ where: { id: jobId, AND: [buildDefaultCanonicalVisibilityWhere()] }, include: { eligibility: true } });
  if (!job || job.eligibility?.submissionCategory === "MANUAL_ONLY" || !applicationContext(job.applyUrl, true) || new URL(job.applyUrl).protocol !== "https:")
    throw new AssistantError("This posting is unavailable or needs a manual application. Check the original posting.", 409);
  const checks = evaluateRequirements(requirements, job, profile.location ?? "");
  if (!checks.passed) throw new AssistantError(`This job no longer meets your requirements: ${[...checks.conflicts, ...checks.unknown].join(", ")}.`, 409);
  return job;
}

export async function queueAutoApplyJob(userId: string, jobId: string) {
  const job = await eligibleJob(userId, jobId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const existing = await tx.trackedApplication.findUnique({ where: { userId_canonicalJobId: { userId, canonicalJobId: job.id } } });
    if (existing && !["PREPARING", "WISHLIST"].includes(existing.status)) throw new AssistantError("This job is already in your application history. It was not queued again.", 409);
    if (existing?.status === "PREPARING") return { id: existing.id };
    if (await tx.trackedApplication.count({ where: { userId, status: "PREPARING" } }) >= 100)
      throw new AssistantError("Your review queue has 100 applications. Finish or remove one before adding another.", 409);
    const data = { status: "PREPARING" as const, events: { create: { type: "NOTE" as const, note: "Added to Auto Apply review queue. Nothing submitted." } } };
    const row = existing ? await tx.trackedApplication.update({ where: { id: existing.id }, data }) : await tx.trackedApplication.create({ data: {
      ...data, userId, canonicalJobId: job.id, company: job.company, roleTitle: job.title, roleUrl: job.applyUrl, jobDescription: job.description,
    } });
    return { id: row.id };
  });
}

export async function removeAutoApplyJob(userId: string, id: string) {
  const result = await prisma.trackedApplication.updateMany({ where: { id, userId, status: "PREPARING" }, data: { status: "WISHLIST" } });
  if (!result.count) throw new AssistantError("This application is no longer in the preparation queue. Refresh the list.", 409);
  return { removed: true };
}

export async function createAutoApplyHandoff(userId: string, id: string) {
  const row = await prisma.trackedApplication.findFirst({ where: { id, userId, status: "PREPARING" } });
  if (!row?.canonicalJobId) throw new AssistantError("Choose a queued job from Matches first.", 404);
  const job = await eligibleJob(userId, row.canonicalJobId);
  const secret = getAuthSecret();
  if (!secret) throw new AssistantError("Application workspace is not configured.", 503);
  return issueWorkspaceToken({ userId, applicationId: id, url: job.applyUrl }, secret);
}

// Both the web session and the connected extension must represent the same user.
// The browser never accepts a caller-supplied employer URL or arbitrary tab ID.
export async function resolveAutoApplyTarget(userId: string, raw: unknown) {
  const input = z.object({ token: z.string().max(6000) }).strict().parse(raw);
  const secret = getAuthSecret();
  const claims = secret && verifyWorkspaceToken(input.token, secret, userId);
  if (!claims) throw new AssistantError("Workspace connection expired or belongs to another account. Reopen this application from Auto Apply.", 403);
  const row = await prisma.trackedApplication.findFirst({ where: { id: claims.applicationId, userId } });
  if (!row?.canonicalJobId || !["PREPARING", "APPLIED"].includes(row.status)) throw new AssistantError("This application is no longer in the review queue.", 409);
  if (row.status === "PREPARING") {
    const job = await eligibleJob(userId, row.canonicalJobId);
    if (job.applyUrl !== claims.url) throw new AssistantError("The employer link changed. Reopen this application from Auto Apply.", 409);
  }
  return { id: row.id, url: claims.url, title: row.roleTitle, company: row.company, status: row.status, nonce: claims.nonce, expires: claims.expires };
}
