import Link from "next/link";
import { redirect } from "next/navigation";
import { Columns2, FileText, Sparkles } from "lucide-react";

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

      <section className="border-y border-border/70 py-6" id="resume-builder">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Resume builder</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Select profile-backed education, experience, projects, and skills for a focused resume. Review AI wording proposals, save an exact draft, and generate a unified PDF.
              </p>
            </div>
          </div>
          <Button render={<Link href="/documents/resume-builder" />} size="sm">
            Open resume builder
          </Button>
        </header>
        <p className="mt-4 text-sm text-muted-foreground">
          {resumeContentCount} reusable content {resumeContentCount === 1 ? "entry" : "entries"} · {resumeBuildCount} active {resumeBuildCount === 1 ? "draft" : "drafts"}
        </p>
      </section>

      <section id="resume-files">
        <header className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold text-foreground">Resume files &amp; templates</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Upload source resumes and templates. Resume uploads extract and merge profile entries, including education, while preserving your original file.
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
