import { redirect } from "next/navigation";
import { Briefcase, FileText, FolderOpen, User2 } from "lucide-react";

import { prisma } from "@/lib/db";
import { getOptionalSessionUser, requireCurrentProfileId } from "@/lib/current-user";
import { formatFileSize, formatMediumDateTimeEnCa } from "@/lib/formatting";
import { buildProfileFormValues } from "@/lib/profile";
import { type ResumeImportSummary } from "@/lib/resume-shared";
import { getStorageReadiness } from "@/lib/storage";
import { CoverLetterManager } from "@/components/profile/cover-letter-manager";
import { ProfileForm } from "@/components/profile/profile-form";
import { ResumeManager } from "@/components/profile/resume-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PreferencesForm } from "@/app/settings/settings-forms";

type ProfileSummary = {
  headline: boolean;
  summary: boolean;
  location: boolean;
  contact: boolean;
  skills: boolean;
  experiences: boolean;
  educations: boolean;
};

function buildCompleteness(values: ReturnType<typeof buildProfileFormValues>): {
  pct: number;
  filled: number;
  total: number;
  missing: string[];
} {
  const parts: Array<[keyof ProfileSummary, boolean, string]> = [
    ["headline", Boolean(values.headline?.trim()), "headline"],
    ["summary", Boolean(values.summary?.trim()), "summary"],
    ["location", Boolean(values.location?.trim()), "location"],
    [
      "contact",
      Boolean(values.contact.email?.trim() || values.contact.phone?.trim()),
      "contact info",
    ],
    ["skills", values.skills.length > 0, "skills"],
    ["experiences", values.experiences.length > 0, "experience"],
    ["educations", values.educations.length > 0, "education"],
  ];
  const filled = parts.filter(([, done]) => done).length;
  const total = parts.length;
  const missing = parts.filter(([, done]) => !done).map(([, , label]) => label);
  const pct = Math.round((filled / total) * 100);
  return { pct, filled, total, missing };
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sessionUser = await getOptionalSessionUser();

  if (!sessionUser) {
    redirect("/sign-in");
  }

  const profileId = await requireCurrentProfileId();
  const storageReadiness = getStorageReadiness();

  const [profile, resumes, templates, coverLetters] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { id: profileId },
      select: {
        updatedAt: true,
        location: true,
        headline: true,
        summary: true,
        phone: true,
        linkedinUrl: true,
        githubUrl: true,
        portfolioUrl: true,
        preferredWorkMode: true,
        experienceLevel: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
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
  ]);

  const initialValues = buildProfileFormValues(profile, sessionUser);
  const profileFormKey = profile?.updatedAt?.toISOString() ?? "blank-profile";

  const completeness = buildCompleteness(initialValues);
  const resumeCount = resumes.length;
  const primaryResume = resumes.find((resume) => resume.isPrimary) ?? null;
  const coverLetterCount = coverLetters.length;
  const documentCount = resumeCount + templates.length + coverLetterCount;
  const missingApplicationDetails =
    !initialValues.contact.phone.trim() ||
    !initialValues.contact.linkedInUrl.trim() ||
    !initialValues.contact.portfolioUrl.trim();

  const params = await searchParams;
  const requestedTab =
    params.tab === "details" ? "details" : params.tab === "documents" ? "documents" : null;
  const defaultTab =
    requestedTab ?? (missingApplicationDetails || completeness.pct < 70 ? "details" : "documents");

  return (
    <div className="app-page space-y-6">
      <header className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-description">
            Your identity across applications — resumes, cover letters, and the details we send with every submission.
          </p>
        </div>
      </header>

      {/* Summary strip */}
      <section className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
        <SummaryTile
          icon={<User2 className="h-4 w-4" />}
          label="Profile complete"
          value={`${completeness.pct}%`}
          hint={
            completeness.missing.length === 0
              ? "Everything filled in."
              : `Missing: ${completeness.missing.slice(0, 3).join(", ")}${
                  completeness.missing.length > 3 ? "…" : ""
                }`
          }
          progress={completeness.pct}
        />
        <SummaryTile
          icon={<FolderOpen className="h-4 w-4" />}
          label="Documents"
          value={documentCount.toString()}
          hint={
            primaryResume
              ? `Primary: ${primaryResume.title || primaryResume.originalFileName}`
              : documentCount > 0
                ? "Resume, template, and cover letter library"
                : "Upload a resume to start applying"
          }
        />
        <SummaryTile
          icon={<FileText className="h-4 w-4" />}
          label="Templates"
          value={templates.length.toString()}
          hint={
            templates.length > 0
              ? `${coverLetterCount} cover letter${coverLetterCount === 1 ? "" : "s"} saved`
              : "Optional formatting for generated resumes"
          }
        />
      </section>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab} key={defaultTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="details">Application profile</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-4" id="documents">
          <section className="surface-panel p-3.5 sm:p-6">
            <header className="flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Resume and cover letter library
                </h2>
                <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                  Keep uploaded resumes, generation templates, and cover letters organized for applications.
                </p>
              </div>
            </header>

            <div className="mt-3 grid gap-3 sm:mt-5 sm:gap-5">
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
        </TabsContent>

        <TabsContent value="details" className="mt-4" id="application-profile-tab">
          <div className="grid gap-4">
            <section className="surface-panel scroll-mt-24 p-3.5 sm:p-6" id="job-preferences">
              <header className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Job preferences</h2>
              </header>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Used for best-match ranking, salary-aware filtering defaults, and application materials.
              </p>
              <PreferencesForm
                defaults={{
                  preferredWorkMode: profile?.preferredWorkMode ?? "",
                  experienceLevel: profile?.experienceLevel ?? "",
                  salaryMin:
                    profile?.salaryMin !== null && profile?.salaryMin !== undefined
                      ? String(profile.salaryMin)
                      : "",
                  salaryMax:
                    profile?.salaryMax !== null && profile?.salaryMax !== undefined
                      ? String(profile.salaryMax)
                      : "",
                  salaryCurrency: profile?.salaryCurrency ?? "USD",
                  location: profile?.location ?? "",
                }}
              />
            </section>
            <section className="surface-panel p-3.5 sm:p-6" id="application-profile">
              <header className="flex items-start gap-2">
                <User2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Application profile</h2>
                  <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                    Structured identity, experience, and contact fields used to map application forms safely.
                  </p>
                </div>
              </header>
              <ProfileForm
                key={profileFormKey}
                initialValues={{
                  headline: initialValues.headline,
                  summary: initialValues.summary,
                  location: initialValues.location,
                  contact: initialValues.contact,
                  skills: initialValues.skills,
                  educations: initialValues.educations,
                  experiences: initialValues.experiences,
                  projects: initialValues.projects,
                }}
              />
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  hint,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  progress?: number;
}) {
  return (
    <div className="rounded-[16px] border border-border/65 bg-card p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.025)] sm:p-4">
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground sm:gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-accent text-primary">
          {icon}
        </span>
        <span className="hidden truncate text-xs font-medium uppercase tracking-wide sm:inline">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-foreground sm:mt-3 sm:text-2xl">{value}</p>
      {typeof progress === "number" ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : null}
      <p className="mt-2 hidden line-clamp-2 text-xs text-muted-foreground sm:block">{hint}</p>
    </div>
  );
}
