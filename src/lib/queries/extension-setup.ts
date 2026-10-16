import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildProfileFormValues, normalizeContact } from "@/lib/profile";
import { ONBOARDING_KEY, parseOnboardingState, pendingSetupScopes, getSetupCompletionError } from "@/lib/profile-setup";
import { canShareExtensionResume } from "@/lib/extension-resume";
import { allowedExtension } from "@/lib/application-assistant";
import { isSessionUsableByPolicy } from "@/lib/auth-session-policy";
import { AssistantError, hashSecret } from "./application-assistant";
import type { SetupCapabilities } from "@/lib/extension-setup";

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const pendingSchema = z.object({ clientId: z.string(), userId: z.string(), connectionId: z.string().optional() }).strict();
type WebIdentity = { authUserId: string; sessionId: string };
const namespace = (sessionId: string) => `extension-setup:${sessionId}`;

export async function extensionSetupCapabilities(authUserId: string): Promise<SetupCapabilities> {
  const profile = await prisma.userProfile.findUnique({ where: { authUserId }, include: { authUser: { select: { name: true, email: true } } } });
  if (!profile) return { contact: false, pendingReview: false, resume: "none" };
  const [record, resume] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId_key: { userId: profile.id, key: ONBOARDING_KEY } } }),
    prisma.document.findFirst({ where: { userId: profile.id, type: "RESUME", isPrimary: true } }),
  ]);
  const values = buildProfileFormValues(profile, profile.authUser ?? undefined);
  const savedContact = normalizeContact(profile.contactJson);
  const state = parseOnboardingState(record?.value);
  return {
    contact: !getSetupCompletionError(values) && (!state || Boolean(state.confirmedAt) || state.status === "complete" ||
      Boolean(savedContact.fullName && z.email().safeParse(savedContact.email).success)),
    pendingReview: pendingSetupScopes(values, state?.draft).length > 0,
    resume: !resume ? "none" : !canShareExtensionResume(resume) ? "ineligible" : values.contact.autofillResume ? "enabled" : "sharing-off",
  };
}

export async function createSetupChallenge(identity: WebIdentity, clientId: string) {
  if (!allowedExtension(clientId)) throw new AssistantError("This extension is not enabled on this deployment.", 403);
  const challenge = randomBytes(32).toString("base64url");
  // Reuse the existing expiring verification store, with a namespace that cannot
  // overlap authentication tokens. No profile or bearer token is stored here.
  await prisma.verification.deleteMany({ where: { identifier: { startsWith: "extension-setup:" }, expiresAt: { lte: new Date() } } });
  await prisma.verification.create({ data: { id: hashSecret(challenge), identifier: namespace(identity.sessionId),
    value: JSON.stringify({ clientId, userId: identity.authUserId }), expiresAt: new Date(Date.now() + 60_000) } });
  return { challenge };
}

export async function answerSetupChallenge(identity: { userId: string; connectionId: string }, raw: unknown) {
  const { challenge } = z.object({ challenge: token }).strict().parse(raw);
  const record = await prisma.verification.findUnique({ where: { id: hashSecret(challenge) } });
  if (!record || !record.identifier.startsWith("extension-setup:") || record.expiresAt <= new Date()) throw new AssistantError("Connection check expired. Check again.");
  const pending = pendingSchema.parse(JSON.parse(record.value));
  const connection = await prisma.extensionConnection.findUnique({ where: { id: identity.connectionId } });
  if (pending.connectionId || !connection || connection.userId !== identity.userId || connection.clientId !== pending.clientId) throw new AssistantError("Connection check was already used or belongs to another extension.");
  const changed = await prisma.verification.updateMany({ where: { id: record.id, value: record.value, expiresAt: { gt: new Date() } },
    data: { value: JSON.stringify({ ...pending, connectionId: identity.connectionId }) } });
  if (changed.count !== 1) throw new AssistantError("Connection check was already used.");
  return { checked: true, matched: pending.userId === identity.userId };
}

export async function readSetupChallenge(identity: WebIdentity, raw: unknown) {
  const challenge = token.parse(raw);
  const record = await prisma.verification.findUnique({ where: { id: hashSecret(challenge) } });
  if (!record || record.identifier !== namespace(identity.sessionId) || record.expiresAt <= new Date()) throw new AssistantError("Connection check expired. Check again.");
  const pending = pendingSchema.parse(JSON.parse(record.value));
  if (pending.userId !== identity.authUserId) throw new AssistantError("Sign in again to check this account.", 401);
  if (!pending.connectionId) return { state: "disconnected" as const };
  const grant = await prisma.extensionConnection.findUnique({ where: { id: pending.connectionId }, include: { session: true, user: { select: { status: true } } } });
  if (!grant?.connectedAt || grant.expiresAt <= new Date() || !allowedExtension(grant.clientId) || !isSessionUsableByPolicy(grant.session) || grant.user.status !== "ACTIVE") return { state: "disconnected" as const };
  return { state: grant.userId === identity.authUserId ? "verified" as const : "mismatch" as const };
}
