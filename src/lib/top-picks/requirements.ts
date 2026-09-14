import { z } from "zod";
import { convertSalaryAmount } from "@/lib/currency-conversion";
import { inferRegion } from "@/lib/region";

export const REQUIREMENTS_KEY = "top-picks-requirements-v1";
export const requirementsSchema = z
  .object({
    country: z.enum(["ANY", "CA", "US"]).default("ANY"),
    workModes: z
      .array(z.enum(["REMOTE", "HYBRID", "ONSITE", "FLEXIBLE"]))
      .max(4)
      .default([]),
    employmentTypes: z
      .array(z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP"]))
      .max(4)
      .default([]),
    minimumSalary: z
      .number()
      .int()
      .min(0)
      .max(2_000_000)
      .nullable()
      .default(null),
    salaryCurrency: z.enum(["CAD", "USD"]).default("CAD"),
    sponsorshipRequired: z.boolean().default(false),
    unknownPolicy: z.enum(["include", "exclude"]).default("include"),
  })
  .strict();
export type MatchRequirements = z.infer<typeof requirementsSchema>;
export function parseRequirements(raw?: string | null): MatchRequirements {
  try {
    return requirementsSchema.parse(JSON.parse(raw ?? "{}"));
  } catch {
    return requirementsSchema.parse({});
  }
}

type RequirementJob = {
  location: string;
  workMode?: string | null;
  employmentType?: string | null;
  description?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
};
export function evaluateRequirements(
  requirements: MatchRequirements,
  job: RequirementJob,
) {
  const conflicts: string[] = [];
  const unknown: string[] = [];
  const text = job.description ?? "";
  const check = (name: string, result: boolean | null) => {
    if (result === null) unknown.push(name);
    else if (!result) conflicts.push(name);
  };
  if (requirements.workModes.length)
    check(
      "Work arrangement",
      !job.workMode || job.workMode === "UNKNOWN"
        ? null
        : requirements.workModes.includes(
            job.workMode as MatchRequirements["workModes"][number],
          ),
    );
  if (requirements.employmentTypes.length)
    check(
      "Employment type",
      !job.employmentType || job.employmentType === "UNKNOWN"
        ? null
        : requirements.employmentTypes.includes(
            job.employmentType as MatchRequirements["employmentTypes"][number],
          ),
    );
  if (requirements.country !== "ANY") {
    // Ingestion treats unqualified remote roles as NA supply. That heuristic
    // is not evidence that a particular user is eligible to work there.
    const country = inferRegion(
      job.location.replace(
        /\b(?:remote|work from home|worldwide|anywhere|global|north america|americas)\b/gi,
        "",
      ),
    );
    const bothCountries =
      /\b(?:US|USA|United States)\b/i.test(job.location) &&
      /\bCanada\b/i.test(job.location);
    const eligibilityText = text.replace(/\bU\.?S\.?A?\b\.?/g, "United States");
    const eitherCountry =
      /(?:reside|live|based|located)\s+(?:in|within)\s+(?:the\s+)?(?:united states (?:or|and) canada|canada (?:or|and) (?:the )?united states)/i.test(
        eligibilityText,
      );
    const residencyRequired = (countryName: string) =>
      !eitherCountry &&
      new RegExp(
        `(?:(?:must|need to|required to)\\s+(?:reside|live|be (?:based|located|resident))\\s+(?:in|within)\\s+(?:the\\s+)?${countryName}\\b|${countryName}[- ]only\\b|only (?:open|available) to (?:candidates|applicants|residents) (?:based |located |residing )?(?:in|of) (?:the )?${countryName}\\b)`,
        "i",
      ).test(eligibilityText);
    const usOnly = residencyRequired("united states");
    const caOnly = residencyRequired("canada");
    check(
      "Country eligibility",
      (requirements.country === "CA" && usOnly) ||
        (requirements.country === "US" && caOnly)
        ? false
        : bothCountries || eitherCountry
          ? true
          : country
            ? country === requirements.country
            : null,
    );
  }
  if (requirements.minimumSalary != null && requirements.minimumSalary > 0) {
    const minimum = convertSalaryAmount(
      job.salaryMin,
      job.salaryCurrency,
      requirements.salaryCurrency,
    );
    const maximum = convertSalaryAmount(
      job.salaryMax,
      job.salaryCurrency,
      requirements.salaryCurrency,
    );
    check(
      "Minimum advertised salary",
      minimum != null
        ? minimum >= requirements.minimumSalary
        : maximum != null && maximum < requirements.minimumSalary
          ? false
          : null,
    );
  }
  if (requirements.sponsorshipRequired) {
    const unavailable =
      /(?:do(?:es)? not|will not|cannot|can't|unable to|not able to|without).{0,30}(?:visa|immigration|work permit)?\s*sponsor|\bno\s+(?:(?:visa|immigration|work permit)\s+)?sponsorship|sponsorship.{0,15}(?:not available|unavailable|not offered|not provided)/i.test(
        text,
      );
    const available =
      /(?:offer|provide|available|support).{0,30}(?:visa|immigration) sponsorship|(?:visa|immigration) sponsorship.{0,20}(?:available|provided|offered)/i.test(
        text,
      );
    check("Sponsorship", unavailable ? false : available ? true : null);
  }
  return {
    passed:
      !conflicts.length &&
      (requirements.unknownPolicy === "include" || !unknown.length),
    conflicts,
    unknown,
  };
}
