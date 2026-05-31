import {
  fetchBestFormattedJobDescriptionFromUrls,
  getCleanJobDescriptionDisplayBlocks,
  getJobDescriptionCandidateUrls,
  isJobDescriptionSummaryUsable,
  isLowQualityJobDescription,
  isRenderableJobDescription,
  pickBestFormattedJobDescription,
} from "@/lib/job-description-format";
import { ExternalLink } from "lucide-react";

type JobDescriptionSectionProps = {
  title?: string;
  showSourceLink?: boolean;
  job: {
    description: string;
    applyUrl: string;
    sourceMappings: Array<{
      sourceUrl: string | null;
      isPrimary: boolean;
    }>;
    primaryExternalLink: { href: string } | null;
    sourcePostingLink: { href: string } | null;
  };
};

export async function JobDescriptionSection({
  showSourceLink = true,
  title = "Description",
  job,
}: JobDescriptionSectionProps) {
  const candidateUrls = getJobDescriptionCandidateUrls({
    applyUrl: job.applyUrl,
    primaryExternalLink: job.primaryExternalLink,
    sourcePostingLink: job.sourcePostingLink,
    sourceMappings: job.sourceMappings,
  });
  const preferredSourceUrl = candidateUrls[0] ?? null;
  const storedDescriptionNeedsRepair =
    isLowQualityJobDescription(job.description) ||
    !isJobDescriptionSummaryUsable(job.description);
  const fetchedDescription = storedDescriptionNeedsRepair
    ? await fetchBestFormattedJobDescriptionFromUrls(candidateUrls, 3)
    : null;
  const displayDescription =
    pickBestFormattedJobDescription([fetchedDescription, job.description]) ?? job.description;
  const descriptionBlocks = getCleanJobDescriptionDisplayBlocks(displayDescription, 8);
  const descriptionUsable =
    !isLowQualityJobDescription(displayDescription) &&
    isRenderableJobDescription(displayDescription) &&
    isJobDescriptionSummaryUsable(displayDescription);
  const shouldShowDescription = descriptionUsable && descriptionBlocks.length > 0;

  return (
    <section className="surface-panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      </div>

      {shouldShowDescription ? (
        <div className="mt-3 space-y-2.5 text-[13px] leading-5 text-foreground/82">
          {descriptionBlocks.map((block, index) => {
            if (block.kind === "header") {
              return (
                <p
                  key={index}
                  className="pt-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground/60 first:pt-0"
                >
                  {block.text}
                </p>
              );
            }

            if (block.kind === "list") {
              return (
                <ul
                  key={index}
                  className="ml-5 list-disc space-y-1.5 marker:text-muted-foreground/60"
                >
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex} className="leading-5">
                      {item}
                    </li>
                  ))}
                </ul>
              );
            }

            return (
              <p key={index} className="leading-5 text-foreground/80">
                {block.text}
              </p>
            );
          })}
        </div>
      ) : null}

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
