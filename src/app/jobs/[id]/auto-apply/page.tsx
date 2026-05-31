import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";

import { AutoApplyWorkspace } from "@/components/jobs/auto-apply-workspace";
import type {
  AutoApplyJobContext,
  AutoApplyProfilePreview,
  AutoApplyResumeChoice,
} from "@/components/jobs/auto-apply-workspace";
import { prisma } from "@/lib/db";
import { getOptionalSessionUser, requireCurrentProfileId } from "@/lib/current-user";
import { resolveATSFiller } from "@/lib/automation/fillers";

type AutoApplyPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AutoApplyPage({ params }: AutoApplyPageProps) {
  const sessionUser = await getOptionalSessionUser();
  if (!sessionUser) {
    redirect("/sign-in");
  }

  const { id } = await params;
  const userId = await requireCurrentProfileId();

  const [job, profile] = await Promise.all([
    prisma.jobCanonical.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        company: true,
        applyUrl: true,
        status: true,
        eligibility: {
          select: { submissionCategory: true, reasonDescription: true },
        },
      },
    }),
    prisma.userProfile.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        phone: true,
        location: true,
        workAuthorization: true,
        linkedinUrl: true,
        githubUrl: true,
        portfolioUrl: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        resumeVariants: {
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
          select: {
            id: true,
            label: true,
            isDefault: true,
            targetRoleFamily: true,
            updatedAt: true,
            document: {
              select: { filename: true },
            },
          },
        },
      },
    }),
  ]);

  if (!job || !profile) {
    notFound();
  }

  // Eligibility gate. Supported structured ATS jobs can enter the review-first
      // apply-assistant flow; manual-only jobs stay on the standard job page.
  const isAutoEligible =
    Boolean(job.eligibility) &&
    job.eligibility?.submissionCategory !== "MANUAL_ONLY" &&
    job.status === "LIVE" &&
    /^https?:\/\//i.test(job.applyUrl);

  if (!isAutoEligible) {
    redirect(`/jobs/${job.id}/apply`);
  }

  const atsFiller = resolveATSFiller(job.applyUrl);
  if (!atsFiller) {
    redirect(`/jobs/${job.id}`);
  }

  const jobContext: AutoApplyJobContext = {
    id: job.id,
    title: job.title,
    company: job.company,
    applyUrl: job.applyUrl,
    atsSupported: true,
    atsName: atsFiller.atsName,
  };

  const resumes: AutoApplyResumeChoice[] = profile.resumeVariants.map((variant) => ({
    id: variant.id,
    label: variant.label,
    isDefault: variant.isDefault,
    targetRoleFamily: variant.targetRoleFamily,
    filename: variant.document?.filename ?? null,
    updatedAtLabel: formatDistanceToNowStrict(variant.updatedAt, { addSuffix: true }),
  }));

  const profilePreview: AutoApplyProfilePreview = {
    fullName: profile.name,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    workAuthorization: profile.workAuthorization,
    linkedinUrl: profile.linkedinUrl,
    githubUrl: profile.githubUrl,
    portfolioUrl: profile.portfolioUrl,
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    salaryCurrency: profile.salaryCurrency,
  };

  const defaultResumeId =
    resumes.find((resume) => resume.isDefault)?.id ?? resumes[0]?.id ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-3">
        <Link
          href={`/jobs/${job.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {job.title}
        </Link>
      </div>

      {/* Job context strip */}
      <div className="mb-5 rounded-xl border border-border/70 bg-background/45 p-4">
        <p className="text-xs text-muted-foreground">Apply assistant</p>
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight">
          {job.title}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{job.company}</p>
      </div>

      <AutoApplyWorkspace
        job={jobContext}
        resumes={resumes}
        profilePreview={profilePreview}
        defaultResumeId={defaultResumeId}
      />
    </div>
  );
}
