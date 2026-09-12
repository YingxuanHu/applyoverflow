import {
  getJobDescriptionCandidateUrls,
} from "@/lib/job-description-format";
import { ExternalLink } from "lucide-react";
import { after } from "next/server";
import { enqueueDescriptionRepair } from "@/lib/jobs/description-repair";
import { JobDescriptionContent } from "./job-description-content";

type JobDescriptionSectionProps = {
  title?: string;
  showSourceLink?: boolean;
  job: {
    id: string;
    description: string;
    applyUrl: string;
    sourceMappings: Array<{
      sourceName?: string;
      sourceUrl: string | null;
      isPrimary: boolean;
    }>;
    primaryExternalLink: { href: string } | null;
    sourcePostingLink: { href: string } | null;
  };
};

export function JobDescriptionSection({
  showSourceLink = true,
  title = "Description",
  job,
}: JobDescriptionSectionProps) {
  after(() => enqueueDescriptionRepair(job).catch(() => console.warn("Description repair could not be queued")));
  const candidateUrls = getJobDescriptionCandidateUrls({
    applyUrl: job.applyUrl,
    primaryExternalLink: job.primaryExternalLink,
    sourcePostingLink: job.sourcePostingLink,
    sourceMappings: job.sourceMappings,
  });
  const preferredSourceUrl = candidateUrls[0] ?? null;
  const shouldShowDescription = Boolean(job.description.trim());

  return (
    <section className="surface-panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      </div>

      {shouldShowDescription ? (
        <div className="mt-4">
          <JobDescriptionContent description={job.description} />
        </div>
      ) : <p className="mt-4 text-sm text-muted-foreground">The source description is not available yet. Check the original posting for the full requirements.</p>}

      {showSourceLink && preferredSourceUrl ? (
        <div className={shouldShowDescription ? "mt-5" : "mt-3"}>
          <a
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            href={preferredSourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open original posting
          </a>
        </div>
      ) : null}
    </section>
  );
}
