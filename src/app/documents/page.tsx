import Link from "next/link";
import { redirect } from "next/navigation";
import { Columns2, FileText } from "lucide-react";

import { CoverLetterManager } from "@/components/profile/cover-letter-manager";
import { ResumeBuilder } from "@/components/profile/resume-builder";
import { ResumeManager } from "@/components/profile/resume-manager";
import { Button } from "@/components/ui/button";
import { getOptionalSessionUser, requireCurrentProfileId } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { formatFileSize, formatMediumDateTimeEnCa } from "@/lib/formatting";
import { normalizeResumeBullets } from "@/lib/resume-builder";
import { type ResumeImportSummary } from "@/lib/resume-shared";
import { getStorageReadiness } from "@/lib/storage";

export default async function DocumentsPage() {
  const sessionUser = await getOptionalSessionUser();

  if (!sessionUser) {
    redirect("/sign-in");
  }

  const profileId = await requireCurrentProfileId();
  const storageReadiness = getStorageReadiness();
  const [resumes, templates, coverLetters, resumeLibraryEntries, resumeBuilds, savedJobs] =
    await Promise.all([
      prisma.document.findMany({
        where: { userId: profileId, type: "RESUME" },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          isPrimary: true,
          isAiGenerated: true,
          analysis: {
            select: {
              importSummaryJson: true,
            },
          },
        },
      }),
      prisma.document.findMany({
        where: { userId: profileId, type: "RESUME_TEMPLATE" },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          originalFileName: true,
          mimeType: true,
          isPrimary: true,
        },
      }),
      prisma.document.findMany({
        where: { userId: profileId, type: "COVER_LETTER" },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          isAiGenerated: true,
        },
      }),
      prisma.resumeLibraryEntry.findMany({
        where: { userId: profileId, archivedAt: null },
        orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
        include: {
          variations: {
            where: { approvalStatus: "APPROVED" },
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
            select: {
              id: true,
              name: true,
              summary: true,
              bulletsJson: true,
              targetRoleTags: true,
              isDefault: true,
            },
          },
        },
      }),
      prisma.resumeBuild.findMany({
        where: { userId: profileId },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
          template: { select: { title: true } },
          targetJob: { select: { title: true, company: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.savedJob.findMany({
        where: { userId: profileId, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          canonicalJobId: true,
          canonicalJob: { select: { title: true, company: true } },
        },
      }),
    ]);

  return (
    <div className="app-page space-y-8">
      <header className="page-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-description">
            Manage the resume versions, reusable content, and cover letters you use across applications.
          </p>
        </div>
        <Button render={<Link href="/documents/compare" />} size="sm" variant="outline">
          <Columns2 />
          Compare documents
        </Button>
      </header>

      <section id="resume-library">
        <header className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold text-foreground">Resume library</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Upload resume versions and formatting templates available when you apply.
            </p>
          </div>
        </header>
        <div className="mt-4">
          <ResumeManager
            resumes={resumes.map((resume) => ({
              id: resume.id,
              title: resume.title,
              originalFileName: resume.originalFileName,
              mimeType: resume.mimeType,
              sizeLabel: formatFileSize(resume.sizeBytes),
              createdAtLabel: formatMediumDateTimeEnCa(resume.createdAt),
              isPrimary: resume.isPrimary,
              isAiGenerated: resume.isAiGenerated,
              downloadHref: `/api/profile/documents/${resume.id}/download`,
              importSummary:
                (resume.analysis?.importSummaryJson as ResumeImportSummary | null) ?? null,
              isImported: resume.analysis !== null,
            }))}
            templates={templates.map((template) => ({
              id: template.id,
              title: template.title,
              originalFileName: template.originalFileName,
              mimeType: template.mimeType,
              isPrimary: template.isPrimary,
              downloadHref: `/api/profile/documents/${template.id}/download`,
            }))}
            storageConfigured={storageReadiness.configured}
          />
        </div>
      </section>

      <ResumeBuilder
        builds={resumeBuilds.map((build) => ({
          id: build.id,
          name: build.name,
          status: build.status,
          updatedAtLabel: formatMediumDateTimeEnCa(build.updatedAt),
          itemCount: build._count.items,
          templateName: build.template?.title ?? null,
          targetJobLabel: build.targetJob
            ? `${build.targetJob.title} at ${build.targetJob.company}`
            : null,
        }))}
        entries={resumeLibraryEntries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          title: entry.title,
          organization: entry.organization,
          dateRange: entry.dateRange,
          location: entry.location,
          summary: entry.summary,
          technologies: entry.technologies,
          variations: entry.variations.map((variation) => ({
            id: variation.id,
            name: variation.name,
            summary: variation.summary,
            bullets: normalizeResumeBullets(variation.bulletsJson),
            targetRoleTags: variation.targetRoleTags,
            isDefault: variation.isDefault,
          })),
        }))}
        savedJobs={savedJobs.map((savedJob) => ({
          id: savedJob.canonicalJobId,
          label: `${savedJob.canonicalJob.title} at ${savedJob.canonicalJob.company}`,
        }))}
        templates={templates.map((template) => ({ id: template.id, title: template.title }))}
      />

      <section className="border-t border-border/70 pt-6" id="cover-letter-library">
        <header className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold text-foreground">Cover letter library</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Keep reusable letters and role-specific drafts ready for applications.
            </p>
          </div>
        </header>
        <div className="mt-4">
          <CoverLetterManager
            coverLetters={coverLetters.map((coverLetter) => ({
              id: coverLetter.id,
              title: coverLetter.title,
              originalFileName: coverLetter.originalFileName,
              mimeType: coverLetter.mimeType,
              sizeLabel: formatFileSize(coverLetter.sizeBytes),
              createdAtLabel: formatMediumDateTimeEnCa(coverLetter.createdAt),
              isAiGenerated: coverLetter.isAiGenerated,
              downloadHref: `/api/profile/documents/${coverLetter.id}/download`,
            }))}
            storageConfigured={storageReadiness.configured}
          />
        </div>
      </section>
    </div>
  );
}
