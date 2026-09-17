import Link from "next/link";
import { redirect } from "next/navigation";
import { Columns2, FileText } from "lucide-react";

import { CoverLetterManager } from "@/components/profile/cover-letter-manager";
import { ResumeManager } from "@/components/profile/resume-manager";
import { Button } from "@/components/ui/button";
import { getOptionalSessionUser, requireCurrentProfileId } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { formatFileSize, formatMediumDateTimeEnCa } from "@/lib/formatting";
import { type ResumeImportSummary } from "@/lib/resume-shared";
import { getStorageReadiness } from "@/lib/storage";

export default async function DocumentsPage() {
  const sessionUser = await getOptionalSessionUser();

  if (!sessionUser) {
    redirect("/sign-in");
  }

  const profileId = await requireCurrentProfileId();
  const storageReadiness = getStorageReadiness();
  const [resumes, templates, coverLetters, resumeContentCount, resumeBuildCount] =
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
      prisma.resumeLibraryEntry.count({
        where: { userId: profileId, archivedAt: null },
      }),
      prisma.resumeBuild.count({
        where: { userId: profileId, status: "DRAFT" },
      }),
    ]);

  return (
    <div className="app-page space-y-8">
      <header className="page-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="w-full min-w-0 sm:flex-1">
          <h1 className="page-title">Documents</h1>
          <p className="page-description max-sm:whitespace-normal">
            Manage the resume versions, reusable content, and cover letters you use across applications.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button render={<Link href="/documents/compare" />} size="sm" variant="ghost">
            <Columns2 />Compare documents
          </Button>
          <Button render={<Link href="/documents/resume-builder" />} size="sm">
            <FileText />Resume builder
          </Button>
        </div>
      </header>

      <p className="text-sm text-muted-foreground" id="resume-builder">
        {resumeContentCount} reusable content {resumeContentCount === 1 ? "entry" : "entries"} · {resumeBuildCount} active {resumeBuildCount === 1 ? "draft" : "drafts"}
      </p>

      <section id="resume-files">
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
      </section>

      <section className="border-t border-border/70 pt-6" id="cover-letter-library">
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
      </section>
    </div>
  );
}
