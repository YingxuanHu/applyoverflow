export const SYNTHETIC_AS_OF = new Date("2026-10-25T12:00:00.000Z");
export const ORACLE_WORKLOADS = ["feed", "countryCa", "countryUs", "toronto", "multiCity", "remoteCa", "remoteUs", "tech", "finance", "general"] as const;
export type OracleWorkload = typeof ORACLE_WORKLOADS[number];

type SyntheticCase = {
  name: string;
  industry?: string;
  role?: string;
  region?: string | null;
  location?: string;
  workMode?: string;
  category?: string;
  change?: string;
  matches: OracleWorkload[];
};

// Human-authored expected sets, independent of query builders and classifiers.
// A case without "feed" must be absent from every public result.
export const SYNTHETIC_CASES: SyntheticCase[] = [
  { name: "tech-toronto", matches: ["feed", "countryCa", "toronto", "multiCity", "tech"] },
  { name: "tech-new-york", region: "US", location: "New York, NY", matches: ["feed", "countryUs", "multiCity", "tech"] },
  { name: "finance-toronto", industry: "FINANCE", role: "FINANCE_ACCOUNTING", category: "REVIEW_REQUIRED", matches: ["feed", "countryCa", "toronto", "multiCity", "finance"] },
  { name: "finance-new-york", industry: "FINANCE", role: "FINANCE_ACCOUNTING", region: "US", location: "New York, NY", category: "MANUAL_ONLY", matches: ["feed", "countryUs", "multiCity", "finance"] },
  { name: "marketing-toronto", industry: "GENERAL", role: "MARKETING", matches: ["feed", "countryCa", "toronto", "multiCity", "general"] },
  { name: "marketing-new-york", industry: "GENERAL", role: "MARKETING", region: "US", location: "New York, NY", matches: ["feed", "countryUs", "multiCity", "general"] },
  { name: "remote-us-only", region: "US", location: "Remote, United States", workMode: "REMOTE", matches: ["feed", "countryUs", "remoteUs", "tech"] },
  { name: "remote-canada-only", industry: "FINANCE", role: "FINANCE_ACCOUNTING", location: "Remote, Canada", workMode: "REMOTE", matches: ["feed", "countryCa", "remoteCa", "finance"] },
  { name: "unknown-remote-not-eligible", industry: "GENERAL", role: "MARKETING", region: null, location: "Remote", workMode: "REMOTE", matches: ["feed", "general"] },
  { name: "explicit-north-america", industry: "GENERAL", role: "MARKETING", region: null, location: "North America", workMode: "REMOTE", matches: ["feed", "countryCa", "countryUs", "remoteCa", "remoteUs", "general"] },
  { name: "explicit-cross-border", region: null, location: "US & Canada", workMode: "REMOTE", matches: ["feed", "countryCa", "countryUs", "remoteCa", "remoteUs", "tech"] },
  { name: "alive-only-old-source", industry: "FINANCE", role: "FINANCE_ACCOUNTING", location: "Ottawa, ON", change: "oldSource", matches: ["feed", "countryCa", "finance"] },
  { name: "alive-only-missing-source", industry: "GENERAL", role: "MARKETING", region: "US", location: "Boston, MA", change: "missingSourceAndReason", matches: ["feed", "countryUs", "general"] },
  { name: "low-role-confidence", location: "Vancouver, BC", change: "lowRole", matches: ["feed", "countryCa"] },
  { name: "classification-blocked", industry: "FINANCE", role: "FINANCE_ACCOUNTING", region: "US", location: "Chicago, IL", change: "badClassification", matches: ["feed", "countryUs"] },
  { name: "unknown-role", industry: "GENERAL", role: "OTHER_UNKNOWN", location: "Montreal, QC", matches: ["feed", "countryCa"] },
  { name: "source-fourteen-day-boundary", change: "sourceBoundary", matches: ["feed", "countryCa", "toronto", "multiCity", "tech"] },
  { name: "deadline-exact-boundary", industry: "GENERAL", role: "MARKETING", region: "US", location: "New York, NY", change: "deadlineBoundary", matches: ["feed", "countryUs", "multiCity", "general"] },
  { name: "explicit-canada-no-region", industry: "FINANCE", role: "FINANCE_ACCOUNTING", region: null, location: "Canada", matches: ["feed", "countryCa", "finance"] },
  { name: "future-source-integrity-defect", region: "US", location: "Seattle, WA", change: "futureSource", matches: ["feed", "countryUs", "tech"] },
  { name: "hidden-index-removed", change: "indexRemoved", matches: [] },
  { name: "hidden-canonical-expired", change: "canonicalExpired", matches: [] },
  { name: "hidden-dead-signal", change: "deadSignal", matches: [] },
  { name: "hidden-broken-link", change: "brokenLink", matches: [] },
  { name: "hidden-canonical-company", change: "canonicalCompany", matches: [] },
  { name: "hidden-index-company", change: "indexCompany", matches: [] },
  { name: "hidden-both-evidence-stale", change: "staleEvidence", matches: [] },
  { name: "hidden-passed-deadline", change: "passedDeadline", matches: [] },
  { name: "hidden-low-availability", change: "lowAvailability", matches: [] },
  { name: "hidden-registration-board", change: "registrationBoard", matches: [] },
  { name: "hidden-generic-ats-company", change: "genericCompany", matches: [] },
  { name: "hidden-no-source-or-alive", change: "noEvidence", matches: [] },
];

export const SYNTHETIC_SCHEMA = `
  CREATE TYPE "JobStatus" AS ENUM ('LIVE', 'EXPIRED', 'REMOVED');
  CREATE TYPE "Region" AS ENUM ('US', 'CA');
  CREATE TYPE "WorkMode" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE', 'FLEXIBLE', 'UNKNOWN');
  CREATE TABLE "JobCanonical" (
    id text PRIMARY KEY, company text NOT NULL DEFAULT 'Synthetic Company', "applyUrl" text NOT NULL DEFAULT 'https://example.test/synthetic-job',
    status "JobStatus" NOT NULL DEFAULT 'LIVE', "availabilityScore" float NOT NULL DEFAULT 60,
    "deadSignalAt" timestamp, "applyUrlValidationStatus" text, deadline timestamp,
    "lastSourceSeenAt" timestamp DEFAULT '2026-10-25 12:00:00', "lastConfirmedAliveAt" timestamp,
    "postedAt" timestamp NOT NULL DEFAULT '2026-10-24 12:00:00',
    description text NOT NULL DEFAULT repeat('Fictional synthetic posting. Never apply. ', 40)
  );
  CREATE TABLE "JobFeedIndex" (
    "canonicalJobId" text PRIMARY KEY REFERENCES "JobCanonical"(id), status "JobStatus" NOT NULL DEFAULT 'LIVE', company text NOT NULL DEFAULT 'Synthetic Company',
    "applyUrl" text NOT NULL DEFAULT 'https://example.test/synthetic-job', region "Region", industry text NOT NULL,
    location text NOT NULL, "workMode" "WorkMode" NOT NULL,
    title text NOT NULL, "normalizedRoleCategory" text NOT NULL, "normalizedRoleCategoryConfidence" float DEFAULT 0.9,
    "classificationStatus" text DEFAULT 'CONFIDENT', "submissionCategory" text DEFAULT 'READY_TO_APPLY',
    "rankingScore" float NOT NULL DEFAULT 100, "freshnessScore" float NOT NULL DEFAULT 100,
    "qualityScore" float NOT NULL DEFAULT 95, "trustScore" float NOT NULL DEFAULT 90,
    "postedAt" timestamp NOT NULL DEFAULT '2026-10-24 12:00:00'
  );
  CREATE TABLE "JobEligibility" (
    "canonicalJobId" text PRIMARY KEY REFERENCES "JobCanonical"(id), "submissionCategory" text NOT NULL DEFAULT 'READY_TO_APPLY',
    "reasonCode" text DEFAULT 'SYNTHETIC', "reasonDescription" text DEFAULT 'Synthetic classification only'
  );
`;

export function syntheticId(sequence: number) { return `synthetic-${String(sequence).padStart(6, "0")}`; }

export function expectedSyntheticIds(rows: number, workload: OracleWorkload) {
  const result = [];
  for (let i = rows - 1; i >= 0; i--) if (SYNTHETIC_CASES[i % SYNTHETIC_CASES.length].matches.includes(workload)) result.push(syntheticId(i));
  return result;
}

export function syntheticTemplates() {
  return SYNTHETIC_CASES.map((entry, caseIndex) => ({
    caseIndex, industry: entry.industry ?? "TECH", role: entry.role ?? "SOFTWARE_ENGINEERING",
    region: entry.region === undefined ? "CA" : entry.region, location: entry.location ?? "Toronto, ON",
    workMode: entry.workMode ?? "ONSITE", category: entry.category ?? "READY_TO_APPLY", change: entry.change ?? "none",
  }));
}

export const SYNTHETIC_SEED_SQL = `
  WITH fixtures AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS t("caseIndex" int, industry text, role text, region text, location text, "workMode" text, category text, change text)),
  numbered AS (SELECT n, f.* FROM generate_series(0, $2::int - 1) n JOIN fixtures f ON f."caseIndex" = n % 32),
  canonical AS (
    INSERT INTO "JobCanonical" (id, company, "applyUrl", status, "availabilityScore", "deadSignalAt", "applyUrlValidationStatus", deadline, "lastSourceSeenAt", "lastConfirmedAliveAt")
    SELECT 'synthetic-' || lpad(n::text, 6, '0'),
      CASE change WHEN 'canonicalCompany' THEN 'Unknown Company' WHEN 'genericCompany' THEN 'lever' ELSE 'Synthetic Company' END,
      CASE change WHEN 'registrationBoard' THEN 'https://weworkremotely.com/job/synthetic' WHEN 'genericCompany' THEN 'https://jobs.lever.co/synthetic' ELSE 'https://example.test/synthetic-job' END,
      (CASE WHEN change = 'canonicalExpired' THEN 'EXPIRED' ELSE 'LIVE' END)::"JobStatus",
      CASE WHEN change = 'lowAvailability' THEN 59 ELSE 60 END,
      CASE WHEN change = 'deadSignal' THEN timestamp '2026-10-24' END,
      CASE WHEN change = 'brokenLink' THEN 'BROKEN_APPLY_LINK' END,
      CASE change WHEN 'passedDeadline' THEN timestamp '2026-10-25 11:59:59.999' WHEN 'deadlineBoundary' THEN timestamp '2026-10-25 12:00:00' END,
      CASE change WHEN 'oldSource' THEN timestamp '2026-10-05' WHEN 'sourceBoundary' THEN timestamp '2026-10-11 12:00:00' WHEN 'staleEvidence' THEN timestamp '2026-10-11 11:59:59.999' WHEN 'missingSourceAndReason' THEN NULL WHEN 'noEvidence' THEN NULL WHEN 'futureSource' THEN timestamp '2026-10-26' ELSE timestamp '2026-10-25 12:00:00' END,
      CASE WHEN change IN ('oldSource', 'missingSourceAndReason') THEN timestamp '2026-10-24' WHEN change = 'staleEvidence' THEN timestamp '2026-09-25 11:59:59.999' END
    FROM numbered RETURNING id
  ), feed AS (
    INSERT INTO "JobFeedIndex" ("canonicalJobId", status, company, region, industry, location, "workMode", title, "normalizedRoleCategory", "normalizedRoleCategoryConfidence", "classificationStatus", "submissionCategory")
    SELECT c.id, (CASE WHEN n.change = 'indexRemoved' THEN 'REMOVED' ELSE 'LIVE' END)::"JobStatus",
      CASE WHEN n.change = 'indexCompany' THEN 'unknown' ELSE 'Synthetic Company' END,
      n.region::"Region", n.industry, n.location, n."workMode"::"WorkMode", 'Synthetic ' || n.role,
      n.role, CASE WHEN n.change = 'lowRole' THEN 0.749 ELSE 0.9 END,
      CASE WHEN n.change = 'badClassification' THEN 'FAILED' ELSE 'CONFIDENT' END, n.category
    FROM canonical c JOIN numbered n ON c.id = 'synthetic-' || lpad(n.n::text, 6, '0') RETURNING "canonicalJobId"
  )
  INSERT INTO "JobEligibility" ("canonicalJobId", "submissionCategory", "reasonDescription")
  SELECT f."canonicalJobId", n.category, CASE WHEN n.change = 'missingSourceAndReason' THEN '' ELSE 'Synthetic classification only' END
  FROM feed f JOIN numbered n ON f."canonicalJobId" = 'synthetic-' || lpad(n.n::text, 6, '0');
`;
