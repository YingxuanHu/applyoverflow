import { buildLeverDescription, type LeverDescription } from "@/lib/ingestion/connectors/lever-description";
import { fetchFormattedJobDescriptionFromUrl } from "@/lib/job-description-fetch";
import { formatJobDescriptionText } from "@/lib/job-description-format";
import { hasUsableSourceDescription } from "./description-quality";
import { matchesDescriptionIdentity, type DescriptionIdentity } from "./description-source";

type MappedDescriptionSource = {
  sourceName: string;
  sourceUrl: string | null;
  rawJob: { rawPayload: unknown; fetchedAt: Date };
};
export type DescriptionRecoveryJob = DescriptionIdentity & {
  description: string;
  applyUrl: string;
  sourceMappings: MappedDescriptionSource[];
};
export type RecoveredDescription = { description: string; sourceUrl: string; method: "source_snapshot" | "source_page"; observedAt: Date };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }

export function descriptionFromSourceSnapshot(source: MappedDescriptionSource, expected: DescriptionIdentity): string | null {
  const payload = record(source.rawJob.rawPayload);
  if (!matchesDescriptionIdentity({ title: text(payload.title), company: text(payload.company) }, expected)) return null;
  const metadata = record(payload.metadata);
  let description = text(payload.description);
  if (source.sourceName.startsWith("Lever:")) {
    const fields: LeverDescription = {};
    for (const key of ["description", "descriptionPlain", "opening", "openingPlain", "descriptionBody", "descriptionBodyPlain", "additional", "additionalPlain", "salaryDescription", "salaryDescriptionPlain"] as const) fields[key] = text(metadata[key]);
    fields.lists = Array.isArray(metadata.lists) ? metadata.lists.map((item) => ({ text: text(record(item).text), content: text(record(item).content) })) : [];
    description = buildLeverDescription(fields) || description;
  } else if (source.sourceName.startsWith("Ashby:")) {
    const detail = record(metadata.detail);
    description = text(detail.descriptionHtml) || text(detail.descriptionPlainText) || description;
  }
  const formatted = formatJobDescriptionText(description);
  return hasUsableSourceDescription(formatted) ? formatted : null;
}

export async function recoverJobDescription(
  job: DescriptionRecoveryJob,
  options: {
    now?: Date;
    fetchDescription?: (url: string, identity: DescriptionIdentity) => Promise<string | null>;
  } = {}
): Promise<RecoveredDescription | null> {
  const now = options.now ?? new Date();
  const currentUsable = hasUsableSourceDescription(job.description);
  // A fresh mapped provider payload can repair known omissions without another
  // network request. Source mappings have already been ordered by source trust.
  for (const source of job.sourceMappings) {
    if (!source.sourceUrl || now.getTime() - source.rawJob.fetchedAt.getTime() > 86_400_000) continue;
    const description = descriptionFromSourceSnapshot(source, job);
    if (description && (!currentUsable || description.length > job.description.length)) {
      return { description, sourceUrl: source.sourceUrl, method: "source_snapshot", observedAt: source.rawJob.fetchedAt };
    }
  }
  const fetchDescription = options.fetchDescription ?? ((url, identity) => fetchFormattedJobDescriptionFromUrl(url, {}, identity));
  const urls = [...new Set([...job.sourceMappings.map((source) => source.sourceUrl), job.applyUrl].filter((url): url is string => Boolean(url)))].slice(0, 3);
  for (const url of urls) {
    const description = await fetchDescription(url, job);
    if (description && hasUsableSourceDescription(description)) {
      return { description, sourceUrl: url, method: "source_page", observedAt: now };
    }
  }
  return null;
}
