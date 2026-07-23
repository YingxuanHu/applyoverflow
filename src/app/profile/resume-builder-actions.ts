"use server";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { generateResumeEntryVariation as generateAiResumeEntryVariation } from "@/lib/ai/resume-entry-variation";
import { buildProfileContext } from "@/lib/ai/context-builders";
import { assessProfileForAi, buildAiProfileText } from "@/lib/ai/profile-context";
import {
  requireAiFeatureAccess,
  requireCurrentUserProfile,
  UnauthorizedError,
} from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { buildProfileFormValues } from "@/lib/profile";
import {
  RESUME_LIBRARY_ENTRY_TYPES,
  RESUME_BUILD_SECTION_ORDER,
  normalizeResumeBullets,
  seedResumeLibraryFromProfile,
} from "@/lib/resume-builder";
import { compileResumePdf, generateUnifiedResumeTeX, type UnifiedResume } from "@/lib/resume-generator";
import { revalidateProfileViews } from "@/lib/revalidation";
import { buildDocumentStorageKey, deleteFile, saveFile } from "@/lib/storage";
import { getOpenAIReadiness } from "@/lib/openai";

export type ResumeBuilderActionState = {
  error: string | null;
  success: string | null;
};

const entryTypeSchema = z.enum(RESUME_LIBRARY_ENTRY_TYPES);
const editableEntryTypeSchema = z.enum(["EXPERIENCE", "PROJECT"]);
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

const revisionSchema = z.object({
  entryId: z.string().min(1).max(80),
  variationId: z.string().min(1).max(80),
  selectedBulletIds: z.array(z.string().regex(/^\d+$/)).min(1, "Select at least one bullet to rewrite."),
  instruction: z.string().trim().min(3, "Add a short instruction for the rewrite.").max(1_200),
});

const entryUpdateSchema = z.object({
  entryId: z.string().min(1).max(80),
  versionName: z.string().trim().min(1, "Name this version before saving.").max(100),
  summary: z.string().trim().max(4_000),
  technologies: z.string().trim().max(1_000),
});

const rewriteApplySchema = z.object({
  variationId: z.string().min(1).max(80),
  versionName: z.string().trim().min(1, "Name this version before saving.").max(100),
});

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

function parseBulletFields(formData: FormData, key: string) {
  return normalizeResumeBullets(
    formData.getAll(key).map((value) => (typeof value === "string" ? value.slice(0, 1_000) : ""))
  );
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 12);
}

export async function importResumeLibraryFromProfile(
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

  const importedCount = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const entry of entries) {
      const existing = await tx.resumeLibraryEntry.findUnique({
        where: {
          userId_sourceProfileKey: {
            userId: user.id,
            sourceProfileKey: entry.sourceProfileKey,
          },
        },
        select: { id: true },
      });
      if (existing) continue;

      await tx.resumeLibraryEntry.create({
        data: {
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
      });
      count += 1;
    }
    return count;
  });

  revalidateProfileViews();
  return {
    error: null,
    success:
      importedCount > 0
        ? `Imported ${importedCount} new profile entr${importedCount === 1 ? "y" : "ies"}. Existing resume entries were not changed.`
        : "No new profile entries to import. Existing resume entries and versions were left unchanged.",
  };
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

  const bullets = formData.getAll("bullet").length > 0
    ? parseBulletFields(formData, "bullet")
    : parseBullets(formData, "bullets");
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

export async function updateResumeLibraryEntry(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before editing resume content.", success: null };

  const parsed = entryUpdateSchema.safeParse({
    entryId: text(formData, "entryId", 80),
    versionName: text(formData, "versionName", 100),
    summary: text(formData, "summary", 4_000),
    technologies: text(formData, "technologies", 1_000),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Name this version before saving.",
      success: null,
    };
  }

  const isBulletEditorSubmission = text(formData, "bulletEditor", 10) === "true";
  const bullets = isBulletEditorSubmission
    ? parseBulletFields(formData, "bullet")
    : parseBullets(formData, "bullets");
  const values = parsed.data;
  const technologies = parseTags(values.technologies);
  const workingBullets = isBulletEditorSubmission
    ? bullets
    : bullets.length > 0
      ? bullets
      : normalizeResumeBullets(values.summary);

  const updated = await prisma.$transaction(async (tx) => {
    const entry = await tx.resumeLibraryEntry.findFirst({
      where: { id: values.entryId, userId: user.id, archivedAt: null },
      select: { id: true },
    });
    if (!entry) return false;

    await tx.resumeLibraryEntryVariation.create({
      data: {
        entryId: entry.id,
        name: values.versionName,
        summary: values.summary || null,
        bulletsJson: workingBullets as Prisma.InputJsonValue,
        technologies,
        source: "USER",
        approvalStatus: "APPROVED",
        isDefault: false,
      },
    });
    return true;
  });
  if (!updated) return { error: "Resume content entry not found.", success: null };

  revalidateProfileViews();
  return {
    error: null,
    success: "New resume-only version saved. Your application profile is unchanged.",
  };
}

export async function generateResumeEntryVariation(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) {
    return { error: "You must sign in before generating a revision.", success: null };
  }

  const parsed = revisionSchema.safeParse({
    entryId: text(formData, "entryId", 80),
    variationId: text(formData, "variationId", 80),
    selectedBulletIds: formData.getAll("selectedBulletId").map((value) => String(value)),
    instruction: text(formData, "instruction", 1_200),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Describe the focus for this revision.",
      success: null,
    };
  }
  if (!getOpenAIReadiness().configured) {
    return { error: "AI revisions are not configured right now.", success: null };
  }

  try {
    await requireAiFeatureAccess();
    const [entry, profileContext] = await Promise.all([
      prisma.resumeLibraryEntry.findFirst({
        where: { id: parsed.data.entryId, userId: user.id, archivedAt: null },
        include: {
          variations: {
            where: { id: parsed.data.variationId, approvalStatus: "APPROVED" },
            select: {
              id: true,
              name: true,
              bulletsJson: true,
              technologies: true,
              targetRoleTags: true,
            },
          },
        },
      }),
      buildProfileContext(),
    ]);

    const editableType = entry ? editableEntryTypeSchema.safeParse(entry.type) : null;
    if (!entry || !editableType?.success) {
      return { error: "Only experience and project entries can be revised this way.", success: null };
    }
    const baseVariation = entry.variations[0];
    if (!baseVariation) {
      return { error: "Choose a version before revising it.", success: null };
    }
    if (!profileContext) {
      return { error: "Your application profile could not be found.", success: null };
    }
    const readiness = assessProfileForAi(profileContext);
    if (!readiness.canUseAi) {
      return { error: readiness.blockingMessage, success: null };
    }

    const selectedBulletIndexes = [...new Set(parsed.data.selectedBulletIds.map(Number))].sort((left, right) => left - right);
    const generated = await generateAiResumeEntryVariation({
      entryTitle: entry.title,
      entryType: editableType.data,
      organization: entry.organization,
      currentBullets: normalizeResumeBullets(baseVariation.bulletsJson),
      selectedBulletIndexes,
      instruction: parsed.data.instruction,
      profileContext: buildAiProfileText(profileContext),
    });

    await prisma.resumeLibraryEntryVariation.create({
      data: {
        entryId: entry.id,
        name: `AI: ${generated.name}`.slice(0, 100),
        sourceVariationId: baseVariation.id,
        rewrittenBulletIndexes: selectedBulletIndexes,
        summary: null,
        bulletsJson: generated.bullets as Prisma.InputJsonValue,
        technologies: baseVariation.technologies,
        targetRoleTags: baseVariation.targetRoleTags,
        source: "AI_GENERATED",
        approvalStatus: "PENDING",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { error: "You must sign in before generating a revision.", success: null };
    }
    return {
      error: error instanceof Error ? error.message.slice(0, 500) : "Could not generate a revision.",
      success: null,
    };
  }

  revalidateProfileViews();
  return { error: null, success: "AI version ready to compare. Review it before adding it to your version list." };
}

export async function applyResumeEntryRewrite(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before applying an AI rewrite.", success: null };

  const parsed = rewriteApplySchema.safeParse({
    variationId: text(formData, "variationId", 80),
    versionName: text(formData, "versionName", 100),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Name this version before saving.", success: null };
  }
  const proposedBullets = parseBulletFields(formData, "bullet");
  const proposal = await prisma.resumeLibraryEntryVariation.findFirst({
    where: {
      id: parsed.data.variationId,
      source: "AI_GENERATED",
      approvalStatus: "PENDING",
      entry: { userId: user.id, archivedAt: null },
    },
    select: {
      id: true,
      entryId: true,
      bulletsJson: true,
      rewrittenBulletIndexes: true,
    },
  });
  if (!proposal) {
    return { error: "That AI rewrite is no longer available.", success: null };
  }

  const originalBullets = normalizeResumeBullets(proposal.bulletsJson);
  if (proposedBullets.length !== originalBullets.length) {
    return { error: "Keep the same number of bullets when reviewing an AI rewrite. Use Edit as new version to add or remove bullets.", success: null };
  }
  const editableIndexes = proposal.rewrittenBulletIndexes.length > 0
    ? new Set(proposal.rewrittenBulletIndexes)
    : new Set(originalBullets.map((_, index) => index));
  const changedUnselectedBullet = proposedBullets.some(
    (bullet, index) => !editableIndexes.has(index) && bullet !== originalBullets[index]
  );
  if (changedUnselectedBullet) {
    return { error: "Only the AI-selected bullets can be edited in this review. Use Edit as new version for the remaining bullets.", success: null };
  }

  await prisma.resumeLibraryEntryVariation.update({
    where: { id: proposal.id },
    data: {
      name: parsed.data.versionName,
      bulletsJson: proposedBullets as Prisma.InputJsonValue,
      approvalStatus: "APPROVED",
      isDefault: false,
    },
  });

  revalidateProfileViews();
  return { error: null, success: "AI rewrite saved as a new entry version. Your prior versions remain unchanged." };
}

export async function dismissResumeEntryRewrite(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before dismissing an AI rewrite.", success: null };

  const variationId = text(formData, "variationId", 80);
  const result = await prisma.resumeLibraryEntryVariation.updateMany({
    where: {
      id: variationId,
      source: "AI_GENERATED",
      approvalStatus: "PENDING",
      entry: { userId: user.id, archivedAt: null },
    },
    data: { approvalStatus: "REJECTED" },
  });
  if (result.count === 0) {
    return { error: "That AI rewrite is no longer available.", success: null };
  }

  revalidateProfileViews();
  return { error: null, success: "AI rewrite dismissed." };
}

export async function duplicateResumeEntryVariation(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before duplicating a version.", success: null };

  const variationId = text(formData, "variationId", 80);
  const variation = await prisma.resumeLibraryEntryVariation.findFirst({
    where: {
      id: variationId,
      approvalStatus: "APPROVED",
      entry: { userId: user.id, archivedAt: null },
    },
    select: {
      entryId: true,
      name: true,
      summary: true,
      bulletsJson: true,
      technologies: true,
      targetRoleTags: true,
      targetIndustryTags: true,
    },
  });
  if (!variation) return { error: "That resume version is no longer available.", success: null };

  await prisma.resumeLibraryEntryVariation.create({
    data: {
      entryId: variation.entryId,
      name: `Copy of ${variation.name}`.slice(0, 100),
      summary: variation.summary,
      bulletsJson: variation.bulletsJson as Prisma.InputJsonValue,
      technologies: variation.technologies,
      targetRoleTags: variation.targetRoleTags,
      targetIndustryTags: variation.targetIndustryTags,
      source: "USER",
      approvalStatus: "APPROVED",
      isDefault: false,
    },
  });

  revalidateProfileViews();
  return { error: null, success: "Version duplicated. Rename or edit it when you are ready." };
}

export async function renameResumeEntryVariation(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before renaming a version.", success: null };

  const variationId = text(formData, "variationId", 80);
  const name = text(formData, "name", 100);
  if (!name) return { error: "Enter a version name.", success: null };

  const result = await prisma.resumeLibraryEntryVariation.updateMany({
    where: {
      id: variationId,
      approvalStatus: "APPROVED",
      entry: { userId: user.id, archivedAt: null },
    },
    data: { name },
  });
  if (result.count === 0) return { error: "That resume version is no longer available.", success: null };

  revalidateProfileViews();
  return { error: null, success: "Version renamed." };
}

export async function setDefaultResumeEntryVariation(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before choosing a default version.", success: null };

  const variationId = text(formData, "variationId", 80);
  const variation = await prisma.resumeLibraryEntryVariation.findFirst({
    where: {
      id: variationId,
      approvalStatus: "APPROVED",
      entry: { userId: user.id, archivedAt: null },
    },
    select: { id: true, entryId: true },
  });
  if (!variation) return { error: "That resume version is no longer available.", success: null };

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
  return { error: null, success: "Default version updated for future resume selections." };
}

export async function deleteResumeEntryVariation(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before deleting a version.", success: null };

  const variationId = text(formData, "variationId", 80);
  const result = await prisma.$transaction(async (tx) => {
    const variation = await tx.resumeLibraryEntryVariation.findFirst({
      where: {
        id: variationId,
        approvalStatus: "APPROVED",
        entry: { userId: user.id, archivedAt: null },
      },
      select: { id: true, entryId: true, isDefault: true },
    });
    if (!variation) return "missing" as const;

    const approvedCount = await tx.resumeLibraryEntryVariation.count({
      where: { entryId: variation.entryId, approvalStatus: "APPROVED" },
    });
    if (approvedCount <= 1) return "last-version" as const;

    await tx.resumeLibraryEntryVariation.delete({ where: { id: variation.id } });
    if (variation.isDefault) {
      const fallback = await tx.resumeLibraryEntryVariation.findFirst({
        where: { entryId: variation.entryId, approvalStatus: "APPROVED" },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      });
      if (fallback) {
        await tx.resumeLibraryEntryVariation.update({
          where: { id: fallback.id },
          data: { isDefault: true },
        });
      }
    }
    return "deleted" as const;
  });

  if (result === "missing") return { error: "That resume version is no longer available.", success: null };
  if (result === "last-version") {
    return { error: "Keep at least one version for this entry. Add or duplicate a version first.", success: null };
  }

  revalidateProfileViews();
  return { error: null, success: "Version deleted. Existing saved resume drafts keep their frozen snapshot." };
}

export async function deleteResumeEntryBullet(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before removing a bullet.", success: null };

  const variationId = text(formData, "variationId", 80);
  const bulletIndex = Number(text(formData, "bulletIndex", 12));
  if (!Number.isInteger(bulletIndex) || bulletIndex < 0) {
    return { error: "Choose a valid bullet to remove.", success: null };
  }

  const variation = await prisma.resumeLibraryEntryVariation.findFirst({
    where: {
      id: variationId,
      approvalStatus: "APPROVED",
      entry: { userId: user.id, archivedAt: null },
    },
    select: {
      entryId: true,
      name: true,
      summary: true,
      bulletsJson: true,
      technologies: true,
      targetRoleTags: true,
      targetIndustryTags: true,
    },
  });
  if (!variation) return { error: "That resume version is no longer available.", success: null };

  const bullets = normalizeResumeBullets(variation.bulletsJson);
  if (bulletIndex >= bullets.length) return { error: "That bullet is no longer available.", success: null };
  if (bullets.length <= 1) {
    return { error: "Keep at least one bullet in this version, or create an entry without bullets instead.", success: null };
  }

  await prisma.resumeLibraryEntryVariation.create({
    data: {
      entryId: variation.entryId,
      name: `${variation.name} without bullet ${bulletIndex + 1}`.slice(0, 100),
      summary: variation.summary,
      bulletsJson: bullets.filter((_, index) => index !== bulletIndex) as Prisma.InputJsonValue,
      technologies: variation.technologies,
      targetRoleTags: variation.targetRoleTags,
      targetIndustryTags: variation.targetIndustryTags,
      source: "USER",
      approvalStatus: "APPROVED",
      isDefault: false,
    },
  });

  revalidateProfileViews();
  return { error: null, success: "Bullet removed in a new version. The original version remains unchanged." };
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
  const orderedSelection = [...selection.data].sort((left, right) => {
    const leftEntry = entryById.get(left.entryId)!;
    const rightEntry = entryById.get(right.entryId)!;
    const sectionDifference =
      RESUME_BUILD_SECTION_ORDER.indexOf(leftEntry.type as (typeof RESUME_BUILD_SECTION_ORDER)[number]) -
      RESUME_BUILD_SECTION_ORDER.indexOf(rightEntry.type as (typeof RESUME_BUILD_SECTION_ORDER)[number]);
    return sectionDifference !== 0 ? sectionDifference : left.sortOrder - right.sortOrder;
  });
  for (const [sortOrder, selected] of orderedSelection.entries()) {
    const entry = entryById.get(selected.entryId)!;
    if (!RESUME_BUILD_SECTION_ORDER.includes(entry.type as (typeof RESUME_BUILD_SECTION_ORDER)[number])) {
      return { error: "A resume build can only include education, experience, projects, and skills.", success: null };
    }
    const variation = entry.variations.find((candidate) => candidate.id === selected.variationId);
    if (!variation) {
      return { error: "Choose a version for each entry.", success: null };
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
    version: 2,
    createdAt: new Date().toISOString(),
    sectionOrder: RESUME_BUILD_SECTION_ORDER.filter((section) =>
      buildItems.some((item) => item.sectionType === section)
    ),
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown, maxLength = 4_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asTextArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => asText(item, 1_000))
        .filter(Boolean)
        .slice(0, 20)
    : [];
}

function resumeFromBuildSnapshot(
  items: Array<{ sectionType: string; snapshotJson: unknown }>,
  values: ReturnType<typeof buildProfileFormValues>
): UnifiedResume {
  const education: UnifiedResume["education"] = [];
  const experience: UnifiedResume["experience"] = [];
  const projects: UnifiedResume["projects"] = [];
  const skills: string[] = [];

  for (const item of items) {
    const snapshot = asRecord(item.snapshotJson);
    const entry = asRecord(snapshot.entry);
    const variation = asRecord(snapshot.variation);
    const bullets = asTextArray(variation.bullets);
    const entryTechnologies = asTextArray(entry.technologies);
    const variationTechnologies = asTextArray(variation.technologies);

    switch (item.sectionType) {
      case "EDUCATION":
        education.push({
          degree: asText(entry.title, 160),
          school: asText(entry.organization, 160),
          time: asText(entry.dateRange, 120),
          location: asText(entry.location, 160),
          description: asText(variation.summary ?? entry.summary, 4_000),
        });
        break;
      case "EXPERIENCE":
        experience.push({
          title: asText(entry.title, 160),
          company: asText(entry.organization, 160),
          time: asText(entry.dateRange, 120),
          location: asText(entry.location, 160),
          bullets,
        });
        break;
      case "PROJECT":
        projects.push({
          title: asText(entry.title, 160),
          role: asText(entry.organization, 160),
          time: asText(entry.dateRange, 120),
          location: asText(entry.location, 160),
          bullets,
        });
        break;
      case "SKILL":
        skills.push(...variationTechnologies, ...entryTechnologies, ...bullets);
        break;
      default:
        break;
    }
  }

  return {
    contact: {
      name: values.contact.fullName,
      email: values.contact.email,
      phone: values.contact.phone,
      location: values.contact.location,
      linkedin: values.contact.linkedInUrl,
      github: values.contact.githubUrl,
      portfolio: values.contact.portfolioUrl,
    },
    education,
    experience,
    projects,
    skills: [...new Set(skills.map((skill) => skill.trim()).filter(Boolean))].slice(0, 40),
  };
}

export async function generateResumeBuildPdf(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before generating a resume.", success: null };

  const buildId = text(formData, "buildId", 80);
  const [build, profile] = await Promise.all([
    prisma.resumeBuild.findFirst({
      where: { id: buildId, userId: user.id, status: "DRAFT" },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        outputDocument: { select: { id: true, storageKey: true } },
      },
    }),
    prisma.userProfile.findUnique({
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
    }),
  ]);

  if (!build) return { error: "Resume build not found.", success: null };
  if (!profile) return { error: "Your application profile could not be found.", success: null };
  if (build.items.length === 0) return { error: "Add content to this build before generating it.", success: null };

  const profileValues = buildProfileFormValues(profile, { name: profile.name, email: profile.email });
  const resume = resumeFromBuildSnapshot(build.items, profileValues);
  if (!resume.contact.name || !resume.contact.email) {
    return { error: "Add your name and email in Application profile before generating a resume.", success: null };
  }

  const title = `${build.name} resume`.slice(0, 180);
  const storageKey = buildDocumentStorageKey({
    userId: user.id,
    title,
    extension: ".pdf",
    type: "RESUME",
  });

  try {
    const compiled = await compileResumePdf(generateUnifiedResumeTeX(resume), "apply-overflow-resume");
    await saveFile(storageKey, compiled.pdfBuffer, { contentType: "application/pdf" });

    try {
      await prisma.$transaction(async (tx) => {
        const outputDocument = await tx.document.create({
          data: {
            userId: user.id,
            type: "RESUME",
            title,
            originalFileName: `${title}.pdf`,
            filename: `${title}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: compiled.pdfBuffer.byteLength,
            storageKey,
            isAiGenerated: true,
          },
        });
        await tx.resumeBuild.update({
          where: { id: build.id },
          data: { outputDocumentId: outputDocument.id },
        });
        if (build.outputDocument) {
          await tx.document.delete({ where: { id: build.outputDocument.id } });
        }
      });
    } catch (error) {
      await deleteFile(storageKey);
      throw error;
    }

    if (build.outputDocument) {
      await deleteFile(build.outputDocument.storageKey);
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message.slice(0, 500) : "Could not generate the resume PDF.",
      success: null,
    };
  }

  revalidateProfileViews();
  return { error: null, success: "Resume PDF generated and added to your Documents library." };
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
