import type { JobCanonical } from "@/generated/prisma/client";
import { isClearlyNonNorthAmericanLocation } from "@/lib/geo-scope";
import { isExcludedJobTitle } from "@/lib/jobs/scope-policy";
import { inferRegion } from "@/lib/region";
import { extractAndScoreLocation } from "./extraction/location-extractor";
import { extractSalaryV2 } from "./extraction/salary-extractor-v2";
import type { SourceConnectorJob } from "./types";

type CurrentPresentation = Pick<JobCanonical, "title" | "location" | "region" | "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod" | "salarySource" | "salaryRawText">;
type PresentationPatch = Partial<Pick<JobCanonical, "location" | "region" | "locationConfidence" | "locationStatus" | "locationSource" | "salaryCurrency" | "salaryPeriod">>;

export function planJobPresentationRepair(current: CurrentPresentation, source: SourceConnectorJob | null) {
  const patch: PresentationPatch = {};
  const reasons: string[] = [];
  const location = source ? extractAndScoreLocation(source) : null;
  const weakLocation = /^(?:remote|hybrid|on[ -]?site|flexible|multiple locations?)$/i.test(current.location.trim()) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(current.location.trim()) || !current.location.trim();
  if (location && location.confidence >= 0.78 && location.value !== current.location && weakLocation) {
    patch.location = location.value;
    patch.region = inferRegion(location.value);
    patch.locationConfidence = location.confidence;
    patch.locationStatus = location.status;
    patch.locationSource = location.source;
    reasons.push("restore_source_geography");
  }
  const region = inferRegion(patch.location ?? current.location);
  // Never guess over explicit source currency, or change compensation amounts.
  // Require re-extraction to reproduce BOTH stored annualized bounds first.
  if (source && region === "CA" && current.salaryCurrency === "USD" &&
      current.salarySource === "description_regex" && !source.salaryCurrency) {
    const salary = extractSalaryV2({
      salaryMin: null, salaryMax: null, salaryCurrency: null,
      description: current.salaryRawText || source.description, regionHint: region,
    });
    if (salary.status === "present" && salary.currency === "CAD" &&
        salary.annualizedMin === current.salaryMin && salary.annualizedMax === current.salaryMax) {
      patch.salaryCurrency = salary.currency;
      patch.salaryPeriod = salary.period;
      reasons.push("correct_inferred_canadian_currency");
    }
  }
  const hideFromFeed = isExcludedJobTitle(current.title) ||
    isClearlyNonNorthAmericanLocation(patch.location ?? current.location);
  if (hideFromFeed) reasons.push("outside_public_board_scope");
  return { patch, hideFromFeed, reasons };
}
