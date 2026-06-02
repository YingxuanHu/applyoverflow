import {
  decodeHtmlEntitiesFull,
  trimDescriptionPollution,
} from "@/lib/ingestion/html-description";
import {
  extractAndScoreJobTitle,
  extractTitleFromUrl,
} from "@/lib/ingestion/extraction/title-extractor";

const TITLE_ROLE_HINT_RE =
  /\b(engineer|developer|manager|analyst|scientist|designer|architect|consultant|specialist|coordinator|director|lead|leader|partner|recruiter|intern|internship|administrator|technician|officer|developer relations|researcher|associate|representative|banker|sales|customer|content|marketing|marketer|operations|lighter|trainer|tutor|student|co-?op|executive|head|counsel|compliance|clerk|inspector|operator|strategist|electrician|bricklayer|welder|welding|fabrication)\b/i;

const TITLE_BAD_MARKER_RE =
  /(^\s*(?:careers?|jobs?|job listings?|open positions?|redirect|apply|datasets?|models?|spaces?)\s*(?::.*)?$|\b(?:work at|career page|copy of careers|find real[- ]time|parking|join (?:our )?team|we make work|intelligent parking|close search|skip to main content|about us|our current job openings|what do we offer)\b)/i;

const TITLE_LOCATION_ONLY_RE =
  /^(?:remote|hybrid|onsite|on-site|canada|united states|usa|toronto|montreal|montréal|vancouver|calgary|ottawa|edmonton|winnipeg|mississauga|waterloo|kitchener|laval|quebec|québec|new york|san francisco|seattle|boston|chicago|austin|dallas|los angeles|washington|london|paris|berlin|singapore|apac|emea|latam|europe|asia|africa|middle east|united kingdom|uk|india|australia)(?:\s+(?:office|area|region|centre|center|city))?$/i;

const COMPANY_BAD_MARKER_RE =
  /\b(jobs?|careers?|career page|work at|hiring|logo|intelligent parking|using ai|find real[- ]time|close search|skip to main content)\b/i;

const COMMON_SECOND_LEVEL_TLDS = new Set([
  "co",
  "com",
  "org",
  "net",
  "gov",
  "ac",
]);

const COMPANY_HOST_BLOCKLIST = new Set([
  "ashbyhq",
  "greenhouse",
  "jobvite",
  "jooble",
  "lever",
  "myworkdayjobs",
  "oraclecloud",
  "recruitee",
  "smartrecruiters",
  "workable",
  "gc",
]);

const UNKNOWN_COMPANY_NAMES = new Set([
  "",
  "unknown",
  "unknown company",
  "yourcompany",
  "your company",
]);

const GENERIC_ATS_COMPANY_HOST_PATTERNS: Array<{
  company: string;
  hostPattern: RegExp;
}> = [
  { company: "ashbyhq", hostPattern: /ashbyhq\.com/i },
  { company: "greenhouse", hostPattern: /greenhouse\.io/i },
  { company: "lever", hostPattern: /lever\.co/i },
  { company: "myworkdayjobs", hostPattern: /myworkdayjobs\.com/i },
  { company: "recruitee", hostPattern: /recruitee\.com/i },
  { company: "smartrecruiters", hostPattern: /smartrecruiters\.com/i },
  { company: "workable", hostPattern: /workable\.com/i },
  { company: "icims", hostPattern: /icims\.com/i },
  { company: "jobvite", hostPattern: /jobvite\.com/i },
  { company: "bamboohr", hostPattern: /bamboohr\.com/i },
  { company: "oraclecloud", hostPattern: /oraclecloud\.com/i },
  { company: "gc", hostPattern: /(?:jobbank\.gc\.ca|\.gc\.ca)/i },
  { company: "taleo", hostPattern: /(?:taleo\.net|taleo\.com|oraclecloud\.com)/i },
  { company: "rippling", hostPattern: /rippling\.com/i },
  { company: "paylocity", hostPattern: /paylocity\.com/i },
  { company: "adp", hostPattern: /(?:workforcenow\.adp\.com|adp\.com)/i },
  { company: "jobappnetwork", hostPattern: /jobappnetwork\.com/i },
  { company: "workstream", hostPattern: /workstream\.(?:us|is|co)/i },
  { company: "hcshiring", hostPattern: /hcshiring\.com/i },
  { company: "typeform", hostPattern: /typeform\.com/i },
  { company: "successfactors", hostPattern: /successfactors\.com/i },
  { company: "teamtailor", hostPattern: /teamtailor\.com/i },
];

const CHROME_LINE_PATTERNS = [
  /^skip to main content$/i,
  /^close search$/i,
  /^open search$/i,
  /^close menu$/i,
  /^main navigation$/i,
  /^careers blog$/i,
  /^in-page topics$/i,
  /^(facebook|instagram|twitter|linkedin|youtube|vimeo)$/i,
  /^•\s*(facebook|instagram|twitter|linkedin|youtube|vimeo)$/i,
  /^(login|sign up)$/i,
  /^learn more$/i,
  /^apply for the job$/i,
  /^location$/i,
] satisfies RegExp[];

const FOOTER_START_PATTERNS = [
  /^©\s*20\d{2}\b/i,
  /^body::?-webkit-scrollbar/i,
  /^off-street parking solutions$/i,
  /^turn-by-turn parking navigation$/i,
  /^parking analytics and other services$/i,
  /^resources$/i,
  /^industries$/i,
  /^company$/i,
  /^pricing$/i,
  /^contact us$/i,
  /^investors$/i,
] satisfies RegExp[];

export function sanitizeJobTitle(value: unknown) {
  const normalized = compactWhitespace(decodeHtmlEntitiesFull(asText(value)).replace(/[®™]/g, ""));
  if (!normalized) return "";

  const locationStripped = stripTrailingLocationQualifier(normalized);
  const candidates = new Set<string>([normalized, locationStripped]);
  const addCandidate = (candidate: string) => {
    const compacted = compactWhitespace(candidate);
    if (!compacted) return;
    candidates.add(compacted);

    const slashParts = compacted
      .split(/\s+\/\s+/)
      .map((part) => compactWhitespace(part))
      .filter(Boolean);
    for (const slashPart of slashParts) {
      candidates.add(slashPart);
    }
  };

  const lookingForMatch = normalized.match(
    /\bwe (?:are|'re)\s+looking for (?:an?\s+)?(.+?)(?:\s*(?:[-–—|]|$))/i
  );
  if (lookingForMatch?.[1]) {
    addCandidate(lookingForMatch[1]);
  }

  for (const segment of locationStripped
    .split(/\s+[|–—-]\s+/)
    .map((part) => compactWhitespace(part))
    .filter(Boolean)) {
    addCandidate(segment);
  }

  let best = normalized;
  let bestScore = scoreTitleCandidate(normalized);

  for (const candidate of candidates) {
    const score = scoreTitleCandidate(candidate);
    if (score > bestScore || (score === bestScore && isBetterTiedTitle(candidate, best))) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function selectBestJobTitle(
  value: unknown,
  options?: {
    company?: string | null;
    urls?: Array<string | null | undefined>;
  }
) {
  const extracted = extractAndScoreJobTitle(
    {
      title: asText(value),
      applyUrl: compactWhitespace(options?.urls?.[0] ?? ""),
      sourceUrl: options?.urls?.[1] ?? null,
      metadata: {},
    },
    {
      company: options?.company ?? null,
      urls: options?.urls ?? [],
    }
  );
  if (extracted.value && !["missing", "rejected"].includes(extracted.status)) {
    return extracted.value;
  }
  return deriveJobTitleFromUrls(options?.urls ?? []) ?? "";
}

export function deriveJobTitleFromUrls(urls: Array<string | null | undefined>) {
  for (const value of urls) {
    const title = extractTitleFromUrl(value);
    if (title) return title;
  }

  return null;
}

export function sanitizeCompanyName(
  value: unknown,
  options?: { urls?: Array<string | null | undefined> }
) {
  const normalized = compactWhitespace(
    decodeHtmlEntitiesFull(asText(value)).replace(/[®™]/g, "")
  );
  const hostCandidate = deriveCompanyNameFromUrls(options?.urls ?? []);
  if (!normalized) {
    return hostCandidate ?? "";
  }

  const candidates = new Set<string>([normalized]);
  for (const segment of normalized
    .split(/\s+[|–—-]\s+/)
    .map((part) => compactWhitespace(part))
    .filter(Boolean)) {
    candidates.add(segment);
  }
  if (hostCandidate) {
    candidates.add(hostCandidate);
  }

  let best = normalized;
  let bestScore = scoreCompanyCandidate(normalized, hostCandidate);

  for (const candidate of candidates) {
    const score = scoreCompanyCandidate(candidate, hostCandidate);
    if (score > bestScore || (score === bestScore && candidate.length < best.length)) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function sanitizeJobDescriptionText(
  value: unknown,
  context?: { title?: string | null; location?: string | null }
) {
  const raw = asText(value);
  const withoutNoiseElements = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  const decoded = decodeHtmlEntitiesFull(withoutNoiseElements);
  const withBreaks = decoded
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/?(p|div|section|article|h[1-6]|li|ul|ol|blockquote|tr|td)[^>]*>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  const joined = stripped
    .split(/\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const dePolluted = trimDescriptionPollution(joined);

  const title = compactWhitespace(context?.title ?? "");
  const location = compactWhitespace(context?.location ?? "");
  const lines = dePolluted.split(/\n+/).map((line) => compactWhitespace(line)).filter(Boolean);
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;

    if (index < 4 && title && normalizeComparable(line) === normalizeComparable(title)) {
      continue;
    }

    if (index < 4 && /^location:\s*/i.test(line)) {
      const normalizedLocationLine = normalizeComparable(line.replace(/^location:\s*/i, ""));
      if (!location || normalizedLocationLine === normalizeComparable(location)) {
        continue;
      }
    }

    if (CHROME_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }

    if (
      FOOTER_START_PATTERNS.some((pattern) => pattern.test(line)) &&
      kept.join("\n").length >= 300
    ) {
      break;
    }

    kept.push(line);
  }

  return kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function hasUnresolvedGenericCompanyName(
  company: string,
  applyUrl?: string | null
) {
  const normalizedCompany = normalizeComparable(company);
  if (UNKNOWN_COMPANY_NAMES.has(normalizedCompany)) {
    return true;
  }

  const url = applyUrl ?? "";
  if (normalizedCompany === "j" && /apply\.workable\.com/i.test(url)) {
    return true;
  }
  if (normalizedCompany === "gc" && /(?:jobbank\.gc\.ca|\.gc\.ca)/i.test(url)) {
    return true;
  }

  return GENERIC_ATS_COMPANY_HOST_PATTERNS.some(
    (entry) =>
      normalizedCompany === entry.company && entry.hostPattern.test(url)
  );
}

export function isSuspiciousJobTitle(title: string, company?: string | null) {
  const normalized = compactWhitespace(title);
  if (!normalized) return true;
  const comparable = normalizeComparable(normalized);
  const companyComparable = normalizeComparable(company ?? "");

  if (TITLE_LOCATION_ONLY_RE.test(normalized.replace(/[()]/g, "").trim())) return true;
  if (TITLE_BAD_MARKER_RE.test(normalized)) return true;
  if (/^(?:redirect|apply|job|jobs|career|careers|open positions?)$/i.test(normalized)) {
    return true;
  }
  if (/^(?:req|requisition|job)\s*#?\s*\d+$/i.test(normalized)) return true;
  if (companyComparable && comparable === companyComparable) return true;
  return false;
}

function scoreTitleCandidate(candidate: string) {
  let score = 0;
  const locationCandidate = candidate.replace(/[()]/g, "").trim();
  if (candidate.length >= 4 && candidate.length <= 100) score += 2;
  if (TITLE_ROLE_HINT_RE.test(candidate)) score += 6;
  if (TITLE_ROLE_HINT_RE.test(candidate) && hasMeaningfulTitleQualifier(candidate)) {
    score += 2;
  }
  if (candidate.split(/\s+/).length <= 10) score += 1;
  if (TITLE_LOCATION_ONLY_RE.test(locationCandidate)) score -= 10;
  if (TITLE_BAD_MARKER_RE.test(candidate)) score -= 8;
  if (/\?$/.test(candidate)) score -= 4;
  if (/^[a-z]/.test(candidate)) score -= 1;
  return score;
}

function stripTrailingLocationQualifier(value: string) {
  let current = compactWhitespace(value);

  for (let index = 0; index < 3; index += 1) {
    const withoutParenthetical = current.replace(/\s*\(([^()]+)\)\s*$/u, (match, content) =>
      isLocationOrWorkModeQualifier(content) ? "" : match
    );
    if (withoutParenthetical !== current) {
      current = compactWhitespace(withoutParenthetical);
      continue;
    }

    const delimiterMatch = current.match(/^(.*?)(?:\s+[|–—-]\s+)([^|–—-]+)$/u);
    if (delimiterMatch?.[1] && delimiterMatch[2]) {
      const suffix = compactWhitespace(delimiterMatch[2]);
      if (isLocationOrWorkModeQualifier(suffix)) {
        current = compactWhitespace(delimiterMatch[1]);
        continue;
      }
    }

    break;
  }

  return current || value;
}

function hasMeaningfulTitleQualifier(candidate: string) {
  const parts = candidate
    .split(/\s+[|–—-]\s+/u)
    .map((part) => compactWhitespace(part))
    .filter(Boolean);

  if (parts.length < 2) return false;
  if (!TITLE_ROLE_HINT_RE.test(parts[0] ?? "")) return false;
  return parts.slice(1).some((part) => !isLocationOrWorkModeQualifier(part));
}

function isBetterTiedTitle(candidate: string, current: string) {
  const candidateHasQualifier = hasMeaningfulTitleQualifier(candidate);
  const currentHasQualifier = hasMeaningfulTitleQualifier(current);
  if (candidateHasQualifier !== currentHasQualifier) return candidateHasQualifier;

  return candidate.length < current.length;
}

function isLocationOrWorkModeQualifier(value: string) {
  const normalized = compactWhitespace(value.replace(/[()]/g, ""));
  if (!normalized) return false;
  if (TITLE_LOCATION_ONLY_RE.test(normalized)) return true;

  const parts = normalized
    .split(/\s+(?:[|–—-]|\/)\s+|,\s*/u)
    .map((part) => compactWhitespace(part))
    .filter(Boolean);

  if (parts.length <= 1) {
    return /^(?:remote|hybrid|onsite|on-site)$/i.test(normalized);
  }

  return parts.every(
    (part) =>
      /^(?:remote|hybrid|onsite|on-site)$/i.test(part) ||
      TITLE_LOCATION_ONLY_RE.test(part)
  );
}

function scoreCompanyCandidate(candidate: string, hostCandidate: string | null) {
  let score = 0;
  if (candidate.length >= 2 && candidate.length <= 80) score += 2;
  if (candidate.split(/\s+/).length <= 4) score += 2;
  if (COMPANY_BAD_MARKER_RE.test(candidate)) score -= 8;
  if (/\?$/.test(candidate)) score -= 4;

  if (hostCandidate) {
    const normalizedCandidate = normalizeComparable(candidate);
    const normalizedHost = normalizeComparable(hostCandidate);
    if (
      normalizedCandidate === normalizedHost ||
      normalizedCandidate.includes(normalizedHost) ||
      normalizedHost.includes(normalizedCandidate)
    ) {
      score += 4;
    } else {
      score -= 3;
    }
  }

  return score;
}

function deriveCompanyNameFromUrls(urls: Array<string | null | undefined>) {
  for (const value of urls) {
    if (!value) continue;
    try {
      const url = new URL(value);
      const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
      const pathParts = url.pathname.split("/").map((part) => part.trim()).filter(Boolean);
      const atsCandidate = deriveKnownAtsCompanyName(hostname, pathParts);
      if (atsCandidate) {
        return atsCandidate;
      }

      const labels = hostname.split(".").filter(Boolean);
      if (labels.length === 0) continue;

      let rootLabel = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
      const tld = labels[labels.length - 1] ?? "";
      if (
        labels.length >= 3 &&
        tld.length === 2 &&
        COMMON_SECOND_LEVEL_TLDS.has(labels[labels.length - 2] ?? "")
      ) {
        rootLabel = labels[labels.length - 3] ?? rootLabel;
      }

      if (!rootLabel || /^(jobs?|careers?|app|apply|business)$/.test(rootLabel)) continue;
      if (COMPANY_HOST_BLOCKLIST.has(rootLabel)) continue;
      return formatCompanySlug(rootLabel);
    } catch {
      continue;
    }
  }

  return null;
}

function deriveKnownAtsCompanyName(hostname: string, pathParts: string[]) {
  if (hostname === "jobs.ashbyhq.com" && pathParts[0]) {
    return formatCompanySlug(pathParts[0]);
  }

  if (hostname.endsWith(".greenhouse.io") && pathParts[0]) {
    return formatCompanySlug(pathParts[0]);
  }

  if (hostname === "jobs.lever.co" && pathParts[0]) {
    return formatCompanySlug(pathParts[0]);
  }

  if (hostname === "apply.workable.com" && pathParts[0]) {
    if (pathParts[0].toLowerCase() === "j") {
      return null;
    }
    return formatCompanySlug(pathParts[0]);
  }

  if (hostname.endsWith(".recruitee.com")) {
    return formatCompanySlug(hostname.split(".")[0] ?? "");
  }

  if (hostname === "jobs.smartrecruiters.com" && pathParts[0]) {
    return formatCompanySlug(pathParts[0]);
  }

  if (hostname.endsWith(".myworkdayjobs.com")) {
    const subdomain = hostname.split(".")[0] ?? "";
    const tenant = subdomain.replace(/\.?wd\d*$/i, "");
    return formatCompanySlug(tenant || pathParts[0] || "");
  }

  if (hostname.endsWith(".bamboohr.com")) {
    return formatCompanySlug(hostname.split(".")[0] ?? "");
  }

  if (hostname.endsWith(".teamtailor.com")) {
    const subdomain = hostname.split(".")[0] ?? "";
    if (!/^(?:www|careers?|jobs?)$/i.test(subdomain)) {
      return formatCompanySlug(subdomain);
    }
  }

  if (hostname.includes(".icims.com")) {
    const subdomain = hostname.split(".")[0] ?? "";
    return formatCompanySlug(subdomain.replace(/^careers[-.]?/i, ""));
  }

  if (hostname.endsWith(".oraclecloud.com")) {
    return null;
  }

  if (hostname === "jobs.jobvite.com" && pathParts[0]) {
    return formatCompanySlug(pathParts[0]);
  }

  return null;
}

function formatCompanySlug(value: string) {
  const override = COMPANY_SLUG_NAME_OVERRIDES.get(
    value.toLowerCase().replace(/[^a-z0-9]+/g, "")
  );
  if (override) return override;

  const compacted = value
    .replace(/[-_]+/g, " ")
    .replace(/\b(careers?|jobs?|external|career site)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compacted) return null;
  if (compacted.length <= 4) return compacted.toUpperCase();
  return compacted.replace(/\b\w/g, (char) => char.toUpperCase());
}

const COMPANY_SLUG_NAME_OVERRIDES = new Map<string, string>([
  ["cmegroup", "CME Group"],
  ["crowdstrike", "CrowdStrike"],
  ["andurilindustries", "Anduril Industries"],
  ["asmglobal", "ASM Global"],
  ["bah", "Booz Allen Hamilton"],
  ["bayada", "BAYADA Home Health Care"],
  ["databricks", "Databricks"],
  ["dovercorporation", "Dover Corporation"],
  ["openai", "OpenAI"],
  ["prolificacademicltd", "Prolific Academic Ltd"],
  ["spacex", "SpaceX"],
  ["thenewyorktimes", "The New York Times"],
  ["uipath", "UiPath"],
  ["wppmedia", "WPP Media"],
]);

function normalizeComparable(value: string) {
  return value.toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function asText(value: unknown) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    : "";
}
