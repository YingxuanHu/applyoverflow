"use server";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { requireCurrentUserProfile, UnauthorizedError } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { buildProfileFormValues } from "@/lib/profile";
import {
  RESUME_LIBRARY_ENTRY_TYPES,
  normalizeResumeBullets,
  seedResumeLibraryFromProfile,
} from "@/lib/resume-builder";
import { revalidateProfileViews } from "@/lib/revalidation";

export type ResumeBuilderActionState = {
  error: string | null;
  success: string | null;
};

const entryTypeSchema = z.enum(RESUME_LIBRARY_ENTRY_TYPES);
const selectionSchema = z
  .array(
    z.object({
      entryId: z.string().min(1).max(80),
      variationId: z.string().min(1).max(80),
      includedBulletIds: z.array(z.string().regex(/^\d+$/)).max(20),
      sortOrder: z.number().int().min(0).max(100),
    })
  )
  .min(1, "Choose at least one content entry.")
  .max(25, "A build can include up to 25 content entries.");

async function currentProfile() {
  try {
    return await requireCurrentUserProfile();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return null;
    }
    throw error;
  }
}

function text(formData: FormData, key: string, maxLength: number) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

function parseBullets(formData: FormData, key: string) {
  return normalizeResumeBullets(text(formData, key, 20_000));
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 12);
}

export async function syncResumeLibraryFromProfile(
  previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  void previous;
  void formData;
  const user = await currentProfile();
  if (!user) {
    return { error: "You must sign in before building a resume.", success: null };
  }

  const profile = await prisma.userProfile.findUnique({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      location: true,
      headline: true,
      summary: true,
      phone: true,
      linkedinUrl: true,
      githubUrl: true,
      portfolioUrl: true,
      workAuthorization: true,
      skillsText: true,
      experienceText: true,
      educationText: true,
      projectsText: true,
      contactJson: true,
      skillsJson: true,
      educationsJson: true,
      experiencesJson: true,
      projectsJson: true,
    },
  });

  if (!profile) {
    return { error: "Your application profile could not be found.", success: null };
  }

  const entries = seedResumeLibraryFromProfile(
    buildProfileFormValues(profile, { name: profile.name, email: profile.email })
  );

  if (entries.length === 0) {
    return {
      error: "Add experience, education, projects, or skills to your application profile first.",
      success: null,
    };
  }

  await prisma.$transaction(
    entries.map((entry) =>
      prisma.resumeLibraryEntry.upsert({
        where: {
          userId_sourceProfileKey: {
            userId: user.id,
            sourceProfileKey: entry.sourceProfileKey,
          },
        },
        update: {
          type: entry.type,
          title: entry.title,
          organization: entry.organization,
          dateRange: entry.dateRange,
          location: entry.location,
          summary: entry.summary,
          technologies: entry.technologies,
          archivedAt: null,
        },
        create: {
          userId: user.id,
          type: entry.type,
          title: entry.title,
          organization: entry.organization,
          dateRange: entry.dateRange,
          location: entry.location,
          summary: entry.summary,
          technologies: entry.technologies,
          sourceProfileKey: entry.sourceProfileKey,
          variations: {
            create: {
              name: "General",
              summary: entry.summary,
              bulletsJson: normalizeResumeBullets(entry.summary) as Prisma.InputJsonValue,
              technologies: entry.technologies,
              source: "IMPORTED",
              approvalStatus: "APPROVED",
              isDefault: true,
            },
          },
        },
      })
    )
  );

  revalidateProfileViews();
  return { error: null, success: `Added or refreshed ${entries.length} master content entries.` };
}

export async function addResumeLibraryEntry(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before adding resume content.", success: null };

  const parsedType = entryTypeSchema.safeParse(text(formData, "type", 30));
  const title = text(formData, "title", 160);
  const summary = text(formData, "summary", 4_000);
  if (!parsedType.success || !title) {
    return { error: "Choose a section and enter a title.", success: null };
  }

  const bullets = parseBullets(formData, "bullets");
  await prisma.resumeLibraryEntry.create({
    data: {
      userId: user.id,
      type: parsedType.data,
      title,
      organization: text(formData, "organization", 160) || null,
      dateRange: text(formData, "dateRange", 120) || null,
      location: text(formData, "location", 160) || null,
      summary: summary || null,
      tags: parseTags(text(formData, "tags", 1_000)),
      technologies: parseTags(text(formData, "technologies", 1_000)),
      variations: {
        create: {
          name: "General",
          summary: summary || null,
          bulletsJson: bullets as Prisma.InputJsonValue,
          technologies: parseTags(text(formData, "technologies", 1_000)),
          source: "USER",
          approvalStatus: "APPROVED",
          isDefault: true,
        },
      },
    },
  });

  revalidateProfileViews();
  return { error: null, success: "Content entry added to your resume library." };
}

export async function addResumeEntryVariation(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before adding a variation.", success: null };

  const entryId = text(formData, "entryId", 80);
  const name = text(formData, "name", 100);
  if (!entryId || !name) {
    return { error: "Name this variation before saving it.", success: null };
  }

  const entry = await prisma.resumeLibraryEntry.findFirst({
    where: { id: entryId, userId: user.id, archivedAt: null },
    select: { id: true, summary: true, technologies: true },
  });
  if (!entry) return { error: "Resume content entry not found.", success: null };

  const summary = text(formData, "summary", 4_000) || entry.summary;
  const bullets = parseBullets(formData, "bullets");
  await prisma.resumeLibraryEntryVariation.create({
    data: {
      entryId: entry.id,
      name,
      targetRoleTags: parseTags(text(formData, "targetRoleTags", 1_000)),
      summary: summary || null,
      bulletsJson: (bullets.length > 0 ? bullets : normalizeResumeBullets(summary)) as Prisma.InputJsonValue,
      technologies: entry.technologies,
      source: "USER",
      approvalStatus: "APPROVED",
    },
  });

  revalidateProfileViews();
  return { error: null, success: `Saved the ${name} variation.` };
}

export async function setDefaultResumeEntryVariation(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before changing a variation.", success: null };

  const variationId = text(formData, "variationId", 80);
  const variation = await prisma.resumeLibraryEntryVariation.findFirst({
    where: { id: variationId, entry: { userId: user.id, archivedAt: null } },
    select: { id: true, entryId: true },
  });
  if (!variation) return { error: "Resume variation not found.", success: null };

  await prisma.$transaction([
    prisma.resumeLibraryEntryVariation.updateMany({
      where: { entryId: variation.entryId },
      data: { isDefault: false },
    }),
    prisma.resumeLibraryEntryVariation.update({
      where: { id: variation.id },
      data: { isDefault: true },
    }),
  ]);
  revalidateProfileViews();
  return { error: null, success: "Default variation updated." };
}

export async function createResumeBuild(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before creating a resume build.", success: null };

  const name = text(formData, "name", 160);
  if (!name) return { error: "Give this resume build a name.", success: null };

  let selectionInput: unknown;
  try {
    selectionInput = JSON.parse(text(formData, "selectionJson", 30_000));
  } catch {
    return { error: "Choose at least one content entry before saving.", success: null };
  }
  const selection = selectionSchema.safeParse(selectionInput);
  if (!selection.success) return { error: selection.error.issues[0]?.message ?? "Invalid build selection.", success: null };

  const entryIds = [...new Set(selection.data.map((item) => item.entryId))];
  if (entryIds.length !== selection.data.length) {
    return { error: "Each content entry can be selected once per build.", success: null };
  }

  const entries = await prisma.resumeLibraryEntry.findMany({
    where: { id: { in: entryIds }, userId: user.id, archivedAt: null },
    include: {
      variations: {
        where: { approvalStatus: "APPROVED" },
        select: {
          id: true,
          name: true,
          summary: true,
          bulletsJson: true,
          technologies: true,
          targetRoleTags: true,
        },
      },
    },
  });
  if (entries.length !== entryIds.length) return { error: "One or more selected entries are unavailable.", success: null };

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const buildItems: Array<{
    entryId: string;
    variationId: string;
    sectionType: (typeof entries)[number]["type"];
    sortOrder: number;
    includedBulletIds: string[];
    snapshotJson: Record<string, unknown>;
  }> = [];
  for (const [sortOrder, selected] of selection.data
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .entries()) {
    const entry = entryById.get(selected.entryId)!;
    const variation = entry.variations.find((candidate) => candidate.id === selected.variationId);
    if (!variation) {
      return { error: "Choose an approved variation for each entry.", success: null };
    }
    const bullets = normalizeResumeBullets(variation.bulletsJson);
    const includedBulletIds = selected.includedBulletIds.filter((id) => Number(id) < bullets.length);
    buildItems.push({
      entryId: entry.id,
      variationId: variation.id,
      sectionType: entry.type,
      sortOrder,
      includedBulletIds,
      snapshotJson: {
        entry: {
          type: entry.type,
          title: entry.title,
          organization: entry.organization,
          dateRange: entry.dateRange,
          location: entry.location,
          summary: entry.summary,
          tags: entry.tags,
          technologies: entry.technologies,
        },
        variation: {
          name: variation.name,
          summary: variation.summary,
          bullets: includedBulletIds.map((id) => bullets[Number(id)]),
          technologies: variation.technologies,
          targetRoleTags: variation.targetRoleTags,
        },
      },
    });
  }

  const templateId = text(formData, "templateId", 80) || null;
  if (templateId) {
    const template = await prisma.document.findFirst({
      where: { id: templateId, userId: user.id, type: "RESUME_TEMPLATE" },
      select: { id: true },
    });
    if (!template) return { error: "Selected template is not available.", success: null };
  }

  const targetJobId = text(formData, "targetJobId", 80) || null;
  if (targetJobId) {
    const savedJob = await prisma.savedJob.findFirst({
      where: { userId: user.id, canonicalJobId: targetJobId },
      select: { id: true },
    });
    if (!savedJob) return { error: "Choose a job from your saved jobs.", success: null };
  }

  const snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    sectionOrder: [...new Set(buildItems.map((item) => item.sectionType))],
    items: buildItems.map((item) => item.snapshotJson),
  };
  await prisma.resumeBuild.create({
    data: {
      userId: user.id,
      name,
      targetJobId,
      templateId,
      status: "DRAFT",
      sectionOrderJson: snapshot.sectionOrder as Prisma.InputJsonValue,
      snapshotJson: snapshot as Prisma.InputJsonValue,
      items: { create: buildItems.map((item) => ({ ...item, snapshotJson: item.snapshotJson as Prisma.InputJsonValue })) },
    },
  });

  revalidateProfileViews();
  return { error: null, success: "Resume build saved as a reproducible draft." };
}

export async function archiveResumeBuild(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before archiving a build.", success: null };
  const buildId = text(formData, "buildId", 80);
  const result = await prisma.resumeBuild.updateMany({
    where: { id: buildId, userId: user.id, status: "DRAFT" },
    data: { status: "ARCHIVED" },
  });
  if (result.count === 0) return { error: "Resume build not found.", success: null };
  revalidateProfileViews();
  return { error: null, success: "Resume build archived." };
}

export async function duplicateResumeBuild(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before duplicating a build.", success: null };
  const buildId = text(formData, "buildId", 80);
  const build = await prisma.resumeBuild.findFirst({
    where: { id: buildId, userId: user.id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!build) return { error: "Resume build not found.", success: null };

  await prisma.resumeBuild.create({
    data: {
      userId: user.id,
      name: `${build.name} copy`.slice(0, 160),
      targetJobId: build.targetJobId,
      templateId: build.templateId,
      status: "DRAFT",
      sectionOrderJson: build.sectionOrderJson as Prisma.InputJsonValue,
      snapshotJson: build.snapshotJson as Prisma.InputJsonValue,
      items: {
        create: build.items.map((item) => ({
          entryId: item.entryId,
          variationId: item.variationId,
          sectionType: item.sectionType,
          sortOrder: item.sortOrder,
          includedBulletIds: item.includedBulletIds as Prisma.InputJsonValue,
          snapshotJson: item.snapshotJson as Prisma.InputJsonValue,
        })),
      },
    },
  });
  revalidateProfileViews();
  return { error: null, success: "Resume build duplicated." };
}
