import { decodeHtmlEntitiesFull } from "@/lib/ingestion/html-description";
import type {
  FieldCandidate,
  FieldCandidateSource,
  SelectedField,
} from "@/lib/ingestion/extraction/types";
import type { SourceConnectorJob } from "@/lib/ingestion/types";

type LocationContext = {
  metadata?: unknown;
};

const LOCATION_SOURCE_WEIGHTS: Partial<Record<FieldCandidateSource, number>> = {
  structured_location: 0.94,
  json_ld: 0.9,
  ats_location: 0.88,
  connector_raw: 0.82,
  html_location: 0.65,
  remote_text: 0.58,
  fallback: 0.25,
};

const LOCATION_PAGE_CHROME_RE =
  /\b(apply now|view job|search jobs|open positions|privacy policy|cookie policy|terms of use|learn more|sign in|login)\b/i;
const REMOTE_RE = /\b(remote|work from home|work-from-home|anywhere)\b/i;
const HYBRID_RE = /\bhybrid\b/i;
const MULTIPLE_RE = /\b(multiple locations?|various locations?|several locations?)\b/i;
const CITY_TOKEN_RE =
  /\b(Toronto|Vancouver|Montreal|Montréal|Calgary|Ottawa|Edmonton|Winnipeg|Waterloo|Kitchener|Mississauga|New York|San Francisco|Seattle|Boston|Chicago|Austin|Dallas|Los Angeles|Denver|Atlanta|Miami|Portland|Washington|Houston|San Diego|San Jose|Palo Alto|Menlo Park|Mountain View|Sunnyvale)\b/gi;

export function extractAndScoreLocation(
  job: Pick<SourceConnectorJob, "location" | "description" | "metadata">,
  context: LocationContext = {}
) {
  const candidates = extractLocationCandidates(job, context);
  return selectBestLocationCandidate(candidates);
}

export function extractLocationCandidates(
  job: Pick<SourceConnectorJob, "location" | "description" | "metadata">,
  context: LocationContext = {}
): FieldCandidate<string>[] {
  const rawCandidates: Array<{ rawValue: string; source: FieldCandidateSource; evidence: string }> = [];
  addRaw(rawCandidates, job.location, "connector_raw", "job.location");

  for (const hit of collectMetadataLocationCandidates(context.metadata ?? job.metadata)) {
    addRaw(rawCandidates, hit.value, hit.source, hit.evidence);
  }

  const remoteFromDescription = extractRemoteLocationText(job.description);
  if (remoteFromDescription) {
    addRaw(rawCandidates, remoteFromDescription, "remote_text", "description.remote_text");
  }

  const seen = new Set<string>();
  const candidates: FieldCandidate<string>[] = [];
  for (const rawCandidate of rawCandidates) {
    const cleaned = cleanLocationCandidate(rawCandidate.rawValue);
    if (!cleaned) continue;
    const key = normalizeComparable(cleaned);
    if (seen.has(`${rawCandidate.source}:${key}`)) continue;
    seen.add(`${rawCandidate.source}:${key}`);
    candidates.push(scoreLocationCandidate(cleaned, rawCandidate));
  }

  return candidates.sort((left, right) => right.confidence - left.confidence);
}

export function selectBestLocationCandidate(
  candidates: FieldCandidate<string>[]
): SelectedField<string> | null {
  if (candidates.length === 0) return null;
  const best = candidates[0]!;
  return {
    ...best,
    status: statusForLocation(best),
  };
}

export function cleanLocationCandidate(raw: unknown) {
  let value = compactWhitespace(
    decodeHtmlEntitiesFull(String(raw ?? ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\u00a0/g, " ")
  );
  if (!value) return "";

  value = value
    .replace(/^(?:location|locations|job location|work location)\s*:?\s*/i, "")
    .replace(/^(?:this role|the role|candidates|employees)\s+(?:can|may|must)?\s*(?:be\s+)?(?:based|located|work)\s+(?:in|from)\s+/i, "")
    .replace(/^(?:based|located)\s+(?:in|from)\s+/i, "");
  value = compactWhitespace(value);

  if (LOCATION_PAGE_CHROME_RE.test(value)) return "";
  if (value.length > 140) {
    const parsed = parseLocationsFromSentence(value);
    if (parsed) return parsed;
    if (REMOTE_RE.test(value)) return HYBRID_RE.test(value) ? "Hybrid" : "Remote";
    return "Multiple Locations";
  }

  const parsed = parseLocationsFromSentence(value);
  if (parsed && parsed.length < value.length) return parsed;

  return value;
}

function scoreLocationCandidate(
  value: string,
  raw: { rawValue: string; source: FieldCandidateSource; evidence: string }
): FieldCandidate<string> {
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = LOCATION_SOURCE_WEIGHTS[raw.source] ?? 0.35;

  if (REMOTE_RE.test(value)) {
    reasons.push("remote_signal");
    score += 0.08;
  }
  if (HYBRID_RE.test(value)) {
    reasons.push("hybrid_signal");
    score += 0.06;
  }
  if (CITY_TOKEN_RE.test(value) || /\b[A-Z]{2}\b/.test(value)) {
    reasons.push("city_or_region_signal");
    score += 0.08;
  }
  CITY_TOKEN_RE.lastIndex = 0;

  if (MULTIPLE_RE.test(value)) {
    reasons.push("multiple_locations");
    score -= 0.08;
  }
  if (value.length > 100) {
    penalties.push("LOCATION_TOO_LONG");
    score -= 0.25;
  }
  if (LOCATION_PAGE_CHROME_RE.test(value)) {
    penalties.push("LOCATION_PAGE_CHROME");
    score -= 0.7;
  }
  if (looksLikeSentence(value)) {
    penalties.push("LOCATION_SENTENCE_LIKE");
    score -= 0.22;
  }

  return {
    value,
    rawValue: raw.rawValue,
    source: raw.source,
    confidence: clamp01(score),
    evidence: raw.evidence,
    reasons,
    penalties,
  };
}

function statusForLocation(candidate: FieldCandidate<string>): SelectedField<string>["status"] {
  if (candidate.penalties.includes("LOCATION_PAGE_CHROME")) return "rejected";
  if (candidate.confidence >= 0.78) return "confident";
  if (candidate.confidence >= 0.6) return "usable_review";
  if (candidate.confidence >= 0.3) return "quarantine";
  return "missing";
}

function parseLocationsFromSentence(value: string) {
  if (MULTIPLE_RE.test(value)) return "Multiple Locations";
  const cityMatches = [...value.matchAll(CITY_TOKEN_RE)].map((match) => match[1]).filter(Boolean);
  CITY_TOKEN_RE.lastIndex = 0;
  const uniqueCities = [...new Set(cityMatches)];
  if (uniqueCities.length >= 2 && uniqueCities.length <= 5) {
    return uniqueCities.join(", ");
  }
  return null;
}

function collectMetadataLocationCandidates(metadata: unknown) {
  const hits: Array<{ value: string; source: FieldCandidateSource; evidence: string }> = [];
  const visit = (value: unknown, path: string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const keyLower = key.toLowerCase();
      const nextPath = [...path, key];
      const pathLower = nextPath.join(".").toLowerCase();
      if (typeof child === "string") {
        if (/(location|joblocation|address|city|workplace)/i.test(keyLower)) {
          hits.push({
            value: child,
            source: /(jsonld|json_ld|structured|schema)/i.test(pathLower)
              ? "json_ld"
              : "structured_location",
            evidence: nextPath.join("."),
          });
        }
      } else {
        visit(child, nextPath);
      }
    }
  };
  visit(metadata, ["metadata"]);
  return hits;
}

function extractRemoteLocationText(description: string | null | undefined) {
  if (!description) return null;
  const firstChunk = description.slice(0, 2000);
  if (/\bremote\s*[-–—]\s*canada\b/i.test(firstChunk)) return "Remote - Canada";
  if (/\bremote\s*[-–—]\s*(?:united states|usa|us)\b/i.test(firstChunk)) return "Remote - United States";
  if (HYBRID_RE.test(firstChunk)) return "Hybrid";
  if (REMOTE_RE.test(firstChunk)) return "Remote";
  return null;
}

function addRaw(
  list: Array<{ rawValue: string; source: FieldCandidateSource; evidence: string }>,
  value: unknown,
  source: FieldCandidateSource,
  evidence: string
) {
  if (typeof value !== "string") return;
  const compacted = compactWhitespace(value);
  if (compacted) list.push({ rawValue: compacted, source, evidence });
}

function looksLikeSentence(value: string) {
  return value.split(/\s+/).length > 16 || /[.!?]$/.test(value);
}

function normalizeComparable(value: string) {
  return compactWhitespace(value).toLowerCase();
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
