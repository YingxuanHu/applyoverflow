/**
 * Workday URL → job title parser.
 *
 * Background: ~200 jobs in production have title set to a bare city name
 * (e.g. "Montreal", "Toronto", "New York"). Cause: the Workday connector
 * fell back to a URL segment that turned out to be the *location*, not the
 * title. Workday URLs are shaped like:
 *
 *     https://{tenant}.{wd[0-9]}.myworkdayjobs.com/{site}/job/{LOCATION}/{TITLE_SLUG}_{REQ_ID}
 *
 * The fix:
 *   1. `extractTitleFromWorkdayUrl(url)` — pulls the slug AFTER the
 *      location segment and humanizes it (strips trailing req id, replaces
 *      hyphens with spaces, collapses whitespace).
 *   2. `isLikelyLocationToken(value)` — cheap check for whether a stored
 *      title actually looks like a city/location string; used by the
 *      backfill script to decide whether to overwrite.
 */

// Curated list of cities + Workday-style location fragments that have shown
// up as bogus titles in production. Kept compact on purpose — only the
// names we've actually observed plus their obvious siblings. False
// positives here are safer than false negatives because the backfill only
// rewrites titles when there's a real URL fallback available.
const KNOWN_LOCATION_TOKENS = new Set([
  "montreal",
  "montral", // Workday's accent-stripped form of "Montréal"
  "toronto",
  "vancouver",
  "calgary",
  "edmonton",
  "ottawa",
  "winnipeg",
  "halifax",
  "quebec",
  "qubec",
  "victoria",
  "kitchener",
  "waterloo",
  "mississauga",
  "brampton",
  "new york",
  "san francisco",
  "los angeles",
  "san jose",
  "san diego",
  "seattle",
  "portland",
  "chicago",
  "boston",
  "austin",
  "dallas",
  "houston",
  "atlanta",
  "denver",
  "phoenix",
  "philadelphia",
  "miami",
  "washington",
  "minneapolis",
  "raleigh",
  "pittsburgh",
  "remote",
  "office",
  "hq",
  "headquarters",
]);

/**
 * Heuristic: does `value` look like a Workday-style location string rather
 * than a real job title?
 *
 *   - Direct match against KNOWN_LOCATION_TOKENS (Montreal, Toronto, …)
 *   - Compound forms like "Toronto Office" or "Montral Qubec" — split into
 *     words and check whether all the meaningful tokens are locations.
 *   - Real job titles contain role words like "Engineer", "Manager",
 *     "Director", "Analyst", etc.; if any of those appear, we bail out and
 *     say it's NOT a location.
 */
export function isLikelyLocationToken(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  // Direct match.
  if (KNOWN_LOCATION_TOKENS.has(normalized)) return true;

  // Real job-title heuristic — if the value contains a role-y word, treat
  // it as a title regardless. Cheap allow-list; broaden as needed.
  const titleWordsPattern =
    /\b(engineer|engineering|manager|director|analyst|designer|developer|architect|associate|advisor|specialist|consultant|coordinator|representative|administrator|technician|scientist|researcher|intern|internship|partner|officer|lead|supervisor|principal|head|vp|president|founder|cto|cfo|coo|ceo|cmo|chief)\b/i;
  if (titleWordsPattern.test(value)) return false;

  // Compound form: walk left-to-right, greedily consuming the longest known
  // location prefix (up to 3 tokens — e.g. "new york new york" should
  // decompose into ["new york", "new york"]). If we can consume the whole
  // string this way, every part of it is a location.
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let span = Math.min(3, words.length - i); span >= 1; span -= 1) {
      const candidate = words.slice(i, i + span).join(" ");
      if (KNOWN_LOCATION_TOKENS.has(candidate)) {
        i += span;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

/**
 * Pull the title slug from a Workday job URL.
 *
 *   …/job/{location}/{title-slug}_{REQ_ID}[?query]
 *
 * Returns null if the URL doesn't fit the pattern.
 */
export function extractTitleFromWorkdayUrl(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== "string") return null;

  // Only operate on Workday-hosted URLs — other ATSes use unrelated path
  // shapes (e.g. Jobvite's `/job/<token>/apply`) and would otherwise produce
  // garbage like title="apply".
  if (!/\.myworkdayjobs\.com\//.test(url)) return null;

  // Strip query/fragment.
  const cleaned = url.split("?")[0]!.split("#")[0]!;

  // Match the canonical Workday job URL shape:
  //   /job/<LOCATION>/<TITLE_SLUG>[_<REQ_ID>]
  //
  // REQ_ID always *starts* with an uppercase letter (Workday tenants use
  // formats like R-0010762, R_1421985, J66968-1, REQ347140-1, REQ12345).
  // We anchor on `_[A-Z]` so a slug ending like "…Montreal_R_1421985"
  // correctly strips the whole `_R_1421985` suffix rather than only the
  // last `_1421985` chunk.
  const match = cleaned.match(
    /\/job\/[^/]+\/(.+?)(?:_[A-Z][A-Za-z0-9_-]*)?\/?$/
  );
  if (!match || !match[1]) return null;

  const slug = match[1];

  // Humanize: hyphens → spaces, collapse runs of whitespace, trim.
  const title = slug
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return title.length > 0 ? title : null;
}

/**
 * Connector-side title selection with the location-fallback guard.
 *   1. JSON-LD title (preferred — Workday's structured payload)
 *   2. Workday list-response title
 *   3. URL-extracted title (only when 1+2 missing OR look like locations)
 *
 * The URL fallback is gated on `isLikelyLocationToken` so a real
 * "Senior Engineer" title never gets clobbered by the URL.
 */
export function selectWorkdayJobTitle(input: {
  jsonLdTitle: string | null | undefined;
  listTitle: string | null | undefined;
  applyUrl: string | null | undefined;
}): string | null {
  const trim = (value: string | null | undefined) => {
    if (typeof value !== "string") return null;
    const stripped = value.trim();
    return stripped.length > 0 ? stripped : null;
  };

  const jsonLd = trim(input.jsonLdTitle);
  const list = trim(input.listTitle);
  const primary = jsonLd ?? list ?? null;

  // If a primary source gave a clearly-real title, use it.
  if (primary && !isLikelyLocationToken(primary)) return primary;

  // Both missing or location-y — try the URL.
  const urlTitle = extractTitleFromWorkdayUrl(input.applyUrl);
  if (urlTitle && !isLikelyLocationToken(urlTitle)) return urlTitle;

  // Nothing better — keep whatever we had (may be null).
  return primary;
}
