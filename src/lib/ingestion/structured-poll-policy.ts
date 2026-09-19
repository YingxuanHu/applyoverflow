type StructuredPollSource = {
  id: string;
  connectorName: string;
  sourceType: string | null;
  extractionRoute: string;
  validationState: string;
  lastValidatedAt: Date | null;
};

/** An explicit canary list can bypass the generic-site pause, never validation
 * or the ordinary queue's concurrency, cooldown and quality gates. */
export function isApprovedStructuredPollSource(
  source: StructuredPollSource,
  now: Date,
  approvedIds = process.env.INGEST_VERIFIED_STRUCTURED_SOURCE_IDS ?? "",
) {
  return approvedIds.split(",").map((id) => id.trim()).includes(source.id) &&
    source.connectorName === "company-site" && source.sourceType === "COMPANY_JSON" &&
    ["STRUCTURED_API", "STRUCTURED_JSON", "STRUCTURED_SITEMAP"].includes(source.extractionRoute) &&
    source.validationState === "VALIDATED" && source.lastValidatedAt !== null &&
    source.lastValidatedAt <= now &&
    now.getTime() - source.lastValidatedAt.getTime() <= 7 * 86400_000;
}
