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
  instruction: z.string().trim().min(12).max(1_200),
});

const entryUpdateSchema = z.object({
  entryId: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  organization: z.string().trim().max(160),
  dateRange: z.string().trim().max(120),
  location: z.string().trim().max(160),
  summary: z.string().trim().max(4_000),
  technologies: z.string().trim().max(1_000),
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

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const libraryEntry = await tx.resumeLibraryEntry.upsert({
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
        },
      });

      const importedVariation = await tx.resumeLibraryEntryVariation.findFirst({
        where: {
          entryId: libraryEntry.id,
          source: "IMPORTED",
          name: "General",
        },
        select: { id: true },
      });
      const variationData = {
        summary: entry.summary,
        bulletsJson: normalizeResumeBullets(entry.summary) as Prisma.InputJsonValue,
        technologies: entry.technologies,
      };

      if (importedVariation) {
        await tx.resumeLibraryEntryVariation.update({
          where: { id: importedVariation.id },
          data: variationData,
        });
      } else {
        await tx.resumeLibraryEntryVariation.create({
          data: {
            entryId: libraryEntry.id,
            name: "General",
            ...variationData,
            source: "IMPORTED",
            approvalStatus: "APPROVED",
            isDefault: true,
          },
        });
      }
    }
  });

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

export async function updateResumeLibraryEntry(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before editing resume content.", success: null };

  const parsed = entryUpdateSchema.safeParse({
    entryId: text(formData, "entryId", 80),
    title: text(formData, "title", 160),
    organization: text(formData, "organization", 160),
    dateRange: text(formData, "dateRange", 120),
    location: text(formData, "location", 160),
    summary: text(formData, "summary", 4_000),
    technologies: text(formData, "technologies", 1_000),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Enter a title before saving this entry.",
      success: null,
    };
  }

  const bullets = parseBullets(formData, "bullets");
  const values = parsed.data;
  const technologies = parseTags(values.technologies);
  const workingBullets =
    bullets.length > 0 ? bullets : normalizeResumeBullets(values.summary);

  const updated = await prisma.$transaction(async (tx) => {
    const entry = await tx.resumeLibraryEntry.findFirst({
      where: { id: values.entryId, userId: user.id, archivedAt: null },
      select: { id: true },
    });
    if (!entry) return false;

    await tx.resumeLibraryEntry.update({
      where: { id: entry.id },
      data: {
        title: values.title,
        organization: values.organization || null,
        dateRange: values.dateRange || null,
        location: values.location || null,
        summary: values.summary || null,
        technologies,
      },
    });
    await tx.resumeLibraryEntryVariation.updateMany({
      where: { entryId: entry.id },
      data: { isDefault: false },
    });
    await tx.resumeLibraryEntryVariation.create({
      data: {
        entryId: entry.id,
        name: "Working copy",
        summary: values.summary || null,
        bulletsJson: workingBullets as Prisma.InputJsonValue,
        technologies,
        source: "USER",
        approvalStatus: "APPROVED",
        isDefault: true,
      },
    });
    return true;
  });
  if (!updated) return { error: "Resume content entry not found.", success: null };

  revalidateProfileViews();
  return {
    error: null,
    success: "Resume working copy updated. Your application profile is unchanged.",
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
      return { error: "Choose a working copy before revising it.", success: null };
    }
    if (!profileContext) {
      return { error: "Your application profile could not be found.", success: null };
    }
    const readiness = assessProfileForAi(profileContext);
    if (!readiness.canUseAi) {
      return { error: readiness.blockingMessage, success: null };
    }

    const generated = await generateAiResumeEntryVariation({
      entryTitle: entry.title,
      entryType: editableType.data,
      organization: entry.organization,
      currentBullets: normalizeResumeBullets(baseVariation.bulletsJson),
      instruction: parsed.data.instruction,
      profileContext: buildAiProfileText(profileContext),
    });

    await prisma.resumeLibraryEntryVariation.create({
      data: {
        entryId: entry.id,
        name: `AI: ${generated.name}`.slice(0, 100),
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
  return { error: null, success: "AI rewrite ready to compare. Choose Use rewrite to add it to this resume." };
}

export async function applyResumeEntryRewrite(
  _previous: ResumeBuilderActionState,
  formData: FormData
): Promise<ResumeBuilderActionState> {
  const user = await currentProfile();
  if (!user) return { error: "You must sign in before applying an AI rewrite.", success: null };

  const variationId = text(formData, "variationId", 80);
  const proposal = await prisma.resumeLibraryEntryVariation.findFirst({
    where: {
      id: variationId,
      source: "AI_GENERATED",
      approvalStatus: "PENDING",
      entry: { userId: user.id, archivedAt: null },
    },
    select: { id: true, entryId: true },
  });
  if (!proposal) {
    return { error: "That AI rewrite is no longer available.", success: null };
  }

  await prisma.$transaction([
    prisma.resumeLibraryEntryVariation.updateMany({
      where: { entryId: proposal.entryId },
      data: { isDefault: false },
    }),
    prisma.resumeLibraryEntryVariation.update({
      where: { id: proposal.id },
      data: { approvalStatus: "APPROVED", isDefault: true },
    }),
  ]);

  revalidateProfileViews();
  return { error: null, success: "AI rewrite is now the working copy for this resume entry." };
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
      return { error: "Choose a working copy for each entry.", success: null };
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
