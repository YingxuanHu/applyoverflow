import type { Region } from "@/generated/prisma/client";
import {
  CA_PROVINCE_CODES,
  CA_PROVINCE_NAMES,
  US_STATE_CODES,
  US_STATE_NAMES,
  hasStrongNonNorthAmericanGeoEvidence,
} from "@/lib/geo-scope";

const US_CITY_MARKERS = [
  "albuquerque",
  "ann arbor",
  "anchorage",
  "arlington",
  "atlanta",
  "austin",
  "baltimore",
  "baton rouge",
  "bellevue",
  "bethesda",
  "billings",
  "birmingham",
  "bismarck",
  "boise",
  "boston",
  "boulder",
  "brooklyn",
  "buffalo",
  "cambridge",
  "charleston",
  "charlotte",
  "cheyenne",
  "chicago",
  "cincinnati",
  "cleveland",
  "columbia",
  "columbus",
  "dallas",
  "denver",
  "des moines",
  "detroit",
  "durham",
  "eugene",
  "fargo",
  "hartford",
  "honolulu",
  "houston",
  "huntsville",
  "indianapolis",
  "irvine",
  "jackson",
  "jacksonville",
  "jersey city",
  "juneau",
  "kansas city",
  "las vegas",
  "lexington",
  "lincoln",
  "little rock",
  "los angeles",
  "louisville",
  "madison",
  "manchester",
  "memphis",
  "miami",
  "milwaukee",
  "minneapolis",
  "montgomery",
  "mountain view",
  "nashville",
  "new haven",
  "new jersey",
  "new orleans",
  "new york",
  "new york city",
  "newark",
  "nyc",
  "oakland",
  "oklahoma city",
  "omaha",
  "orlando",
  "overland park",
  "palo alto",
  "philadelphia",
  "phoenix",
  "pittsburgh",
  "portland",
  "providence",
  "raleigh",
  "redmond",
  "reno",
  "richmond",
  "rochester",
  "sacramento",
  "salt lake city",
  "san antonio",
  "san diego",
  "san francisco",
  "san jose",
  "santa clara",
  "santa fe",
  "scottsdale",
  "seattle",
  "sioux falls",
  "south san francisco",
  "st. louis",
  "stamford",
  "tampa",
  "tucson",
  "tulsa",
  "tysons",
  "washington dc",
  "wichita",
  "wilmington",
];

const CA_CITY_MARKERS = [
  "toronto",
  "vancouver",
  "montreal",
  "montréal",
  "calgary",
  "ottawa",
  "waterloo",
  "mississauga",
  "markham",
  "vaughan",
  "richmond hill",
  "quebec city",
  "saskatoon",
  "winnipeg",
  "hamilton",
  "burnaby",
  "surrey",
  "halifax",
  "edmonton",
  "regina",
  "kitchener",
  "london, on",
  "brampton",
  "scarborough",
  "richmond, bc",
  "laval",
  "longueuil",
  "gatineau",
  "sherbrooke",
  "barrie",
  "st. john",
  "thunder bay",
  "kelowna",
  "victoria, bc",
  "fredericton",
  "moncton",
  "charlottetown",
  "north york",
  "etobicoke",
  "kanata",
  "oakville",
  "burlington, on",
  "guelph",
  "saint-laurent",
  "dorval",
  "grande prairie",
  "red deer",
  "lethbridge",
  "nanaimo",
  "kamloops",
  "prince george",
  "saint john",
  "trois-rivières",
  "saguenay",
  "lévis",
  "terrebonne",
  "brossard",
  "repentigny",
  "newmarket",
  "richmond hill",
  "vaughan",
  "ajax",
  "whitby",
  "oshawa",
  "pickering",
  "cambridge, on",
  "kingston, on",
  "sudbury",
  "peterborough, on",
  "brantford",
  "st. catharines",
  "niagara falls, on",
  "chatham, on",
  "sarnia",
  "windsor, on",
  "coquitlam",
  "langley",
  "abbotsford",
  "new westminster",
  "north vancouver",
  "west vancouver",
  "delta, bc",
  "maple ridge",
  "chilliwack",
  "courtenay",
  "comox",
  "whistler",
  "squamish",
  "acheson",
];

// "USA"/"US" must match as standalone tokens, never as substrings: the naive
// includes("USA") stamped every "Jakarta Pusat" (p-USA-t), "Jerusalem", etc.
// as United States. Word boundaries keep genuine ", USA" / ", US" suffixes.
const US_NAME_PATTERN = /(?<![A-Z])(?:UNITED STATES|U\.?S\.?A\.?|U\.S\.)(?![A-Z])/;

export function inferRegion(location: string): Region | null {
  const normalizedLocation = location.toUpperCase();
  if (
    normalizedLocation.includes("NORTH AMERICA") ||
    normalizedLocation.includes("AMERICAS") ||
    normalizedLocation.includes("US & CANADA") ||
    normalizedLocation.includes("US/CANADA") ||
    normalizedLocation.includes("US AND CANADA")
  ) {
    return "CA";
  }

  // Foreign names outrank the US spelling check: "Jakarta Pusat, ..., ID" and
  // "London, UK; ..." must not resolve US off a substring or city marker.
  if (hasStrongNonNorthAmericanGeoEvidence(location)) {
    return null;
  }

  if (US_NAME_PATTERN.test(normalizedLocation)) {
    return "US";
  }

  if (normalizedLocation.includes("CANADA")) {
    return "CA";
  }

  const loweredLocation = location.toLowerCase();
  if (US_CITY_MARKERS.some((cityMarker) => loweredLocation.includes(cityMarker))) {
    return "US";
  }
  if (CA_CITY_MARKERS.some((cityMarker) => loweredLocation.includes(cityMarker))) {
    return "CA";
  }

  const parts = location
    .split(",")
    .map((segment) => segment.trim().toUpperCase())
    .filter(Boolean);
  const trailingPart = parts[parts.length - 1] ?? "";
  const secondTrailingPart = parts[parts.length - 2] ?? "";

  // Structured ATS feeds often emit Canadian locations as "City, BC, CA".
  // Treat the province + trailing country pair as Canada before the lone "CA"
  // token can be misread as California.
  if (trailingPart === "CA" && CA_PROVINCE_CODES.has(secondTrailingPart)) {
    return "CA";
  }

  // Handle trailing country codes: "City, STATE, US" or "City, PROVINCE, CA"
  // Many ATS feeds (Workday, iCIMS, etc.) append country code after state/province.
  if (
    (trailingPart === "US" || trailingPart === "USA") &&
    US_STATE_CODES.has(secondTrailingPart)
  ) {
    return "US";
  }
  if (trailingPart === "CANADA" && CA_PROVINCE_CODES.has(secondTrailingPart)) {
    return "CA";
  }

  if (US_STATE_CODES.has(trailingPart)) return "US";
  if (CA_PROVINCE_CODES.has(trailingPart)) return "CA";
  if (US_STATE_NAMES.has(trailingPart)) return "US";
  if (CA_PROVINCE_NAMES.has(trailingPart)) return "CA";
  if (US_STATE_NAMES.has(secondTrailingPart)) return "US";
  if (CA_PROVINCE_NAMES.has(secondTrailingPart)) return "CA";

  // Handle remote, worldwide, and work-from-home locations.
  // Pure "Remote" and similar strings are treated as US-eligible: the structured
  // ATS sources we ingest (Greenhouse, Lever, Ashby) are predominantly NA-based
  // companies whose unqualified remote roles target US/CA applicants.
  // Reject only when an explicit non-NA qualifier is present.
  if (
    normalizedLocation.includes("REMOTE") ||
    normalizedLocation.includes("WORK FROM HOME") ||
    normalizedLocation.includes("WORLDWIDE") ||
    normalizedLocation.includes("ANYWHERE") ||
    normalizedLocation === "GLOBAL"
  ) {
    const NON_NA_REMOTE_QUALIFIERS = [
      "EUROPE",
      "EMEA",
      "LATAM",
      "APAC",
      "ASIA",
      "AUSTRALIA",
      "INDIA",
      "AFRICA",
      "MIDDLE EAST",
      "UNITED KINGDOM",
      "GERMANY",
      "FRANCE",
      "BRAZIL",
      "JAPAN",
      "SINGAPORE",
      "NETHERLANDS",
      "SWEDEN",
      "POLAND",
    ];
    if (!NON_NA_REMOTE_QUALIFIERS.some((q) => normalizedLocation.includes(q))) {
      if (
        normalizedLocation.includes("WORLDWIDE") ||
        normalizedLocation.includes("ANYWHERE") ||
        normalizedLocation === "GLOBAL" ||
        normalizedLocation.includes("NORTH AMERICA") ||
        normalizedLocation.includes("AMERICAS") ||
        normalizedLocation.includes("CANADA") ||
        normalizedLocation.includes("US & CANADA") ||
        normalizedLocation.includes("US/CANADA") ||
        normalizedLocation.includes("US AND CANADA")
      ) {
        return "CA";
      }
      return "US";
    }
  }

  return null;
}
