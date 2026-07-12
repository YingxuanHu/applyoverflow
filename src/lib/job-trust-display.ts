// Job-card trust cues: how recently a posting was verified against its source
// and which application platform the posting comes from. Pure display
// decisions — no data access — so cards and the detail page stay consistent.

import { isDemoSourceName } from "@/lib/job-links";

const DAY_MS = 24 * 60 * 60 * 1000;

// Verification older than this is no longer a trust signal worth showing.
const VERIFICATION_MAX_AGE_DAYS = 30;

// Verified/seen within this window reads as "fresh"; older reads as "aging".
const VERIFICATION_FRESH_MAX_AGE_DAYS = 7;

export type VerificationTone = "fresh" | "aging";

export type VerificationDescriptor = {
  /** Short human label, e.g. "Verified today", "Verified 3d ago", "Seen 5d ago" */
  label: string;
  tone: VerificationTone;
};

export type VerificationInput = {
  /** When the posting was last confirmed live on the employer's site. */
  lastConfirmedAliveAt: string | Date | null | undefined;
  /** When the posting was last seen in any source feed (weaker evidence). */
  lastSourceSeenAt: string | Date | null | undefined;
  /** Render-time reference for stable server output; defaults to now. */
  now?: string | Date;
};

/**
 * Describes how recently a posting's liveness was verified. Prefers the
 * strong signal (confirmed alive on the employer's site) and falls back to
 * the weaker "seen in a source feed" signal. Returns null when neither
 * signal exists or the freshest usable one is older than 30 days — stale
 * verification is worse than none.
 */
export function describeVerification(
  input: VerificationInput
): VerificationDescriptor | null {
  const now = toTime(input.now ?? new Date());
  if (now === null) return null;

  const confirmed = describeVerificationSignal(
    input.lastConfirmedAliveAt,
    now,
    "Verified"
  );
  if (confirmed) return confirmed;

  return describeVerificationSignal(input.lastSourceSeenAt, now, "Seen");
}

function describeVerificationSignal(
  value: string | Date | null | undefined,
  now: number,
  verb: "Verified" | "Seen"
): VerificationDescriptor | null {
  const at = toTime(value);
  if (at === null) return null;

  // Clock skew between writers can put timestamps slightly ahead of render
  // time; clamp to "today" rather than dropping the signal.
  const daysAgo = Math.max(0, Math.floor((now - at) / DAY_MS));
  if (daysAgo > VERIFICATION_MAX_AGE_DAYS) return null;

  return {
    label: daysAgo === 0 ? `${verb} today` : `${verb} ${daysAgo}d ago`,
    tone: daysAgo <= VERIFICATION_FRESH_MAX_AGE_DAYS ? "fresh" : "aging",
  };
}

function toTime(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

// ─── Application platform ────────────────────────────────────────────────────

// Source names are "<Family>:<tenant>" (see src/lib/ingestion/connectors).
// Map each known family to the label users recognize on the apply page.
const SOURCE_FAMILY_PLATFORM_LABELS: Record<string, string> = {
  adzuna: "Adzuna",
  ashby: "Ashby",
  breezyhr: "Breezy HR",
  builtin: "Built In",
  companysite: "Company site",
  firstpartycompany: "Company site",
  officialcompany: "Company site",
  greenhouse: "Greenhouse",
  himalayas: "Himalayas",
  hireology: "Hireology",
  hiringcafe: "Hiring Cafe",
  icims: "iCIMS",
  jobbank: "Job Bank",
  jobbanklive: "Job Bank",
  jobicy: "Jobicy",
  jobvite: "Jobvite",
  jooble: "Jooble",
  jsearch: "JSearch",
  lever: "Lever",
  oraclecloud: "Oracle Cloud",
  recruitee: "Recruitee",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  rippling: "Rippling",
  smartrecruiters: "SmartRecruiters",
  successfactors: "SAP SuccessFactors",
  taleo: "Taleo",
  teamtailor: "Teamtailor",
  themuse: "The Muse",
  usajobs: "USAJobs",
  weworkremotely: "We Work Remotely",
  workable: "Workable",
  workatastartup: "Work at a Startup",
  workday: "Workday",
};

/**
 * Human label for the application platform behind a source mapping, derived
 * from the family prefix before ":" (e.g. "Greenhouse:stripe" → "Greenhouse").
 * Unknown families fall back to title-casing so new connectors degrade
 * gracefully. Returns null when there is no usable family.
 */
export function describeApplyPlatform(
  sourceName: string | null | undefined
): string | null {
  if (!sourceName) return null;
  // Seeded demo mappings would title-case into a fake platform name; the rest
  // of the UI already withholds their links, so withhold the chip too.
  if (isDemoSourceName(sourceName)) return null;

  const family = sourceName.split(":")[0]?.trim();
  if (!family) return null;

  const known = SOURCE_FAMILY_PLATFORM_LABELS[family.toLowerCase()];
  if (known) return known;

  return (
    family
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(
        (segment) =>
          segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
      )
      .join(" ") || null
  );
}

/**
 * Picks the source mapping whose platform should be shown on a card: the
 * primary mapping when present, otherwise the first mapping (query layers
 * already order mappings primary-first, best-quality-first).
 */
export function pickApplyPlatformSourceName(
  sourceMappings: Array<{ sourceName: string; isPrimary: boolean }>
): string | null {
  const mapping =
    sourceMappings.find((entry) => entry.isPrimary) ?? sourceMappings[0];
  return mapping?.sourceName ?? null;
}
