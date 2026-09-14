export type LocationSearchRegion = "US" | "CA";

export type ExpandedLocationSearchTerm = {
  raw: string;
  region: LocationSearchRegion | null;
  containsTerms: string[];
  matchedLabels: string[];
};

type LocationDictionaryEntry = {
  label: string;
  region: LocationSearchRegion;
  aliases: string[];
  containsTerms: string[];
};

type SubdivisionTuple = [
  label: string,
  code: string,
  cities: string[],
  extraAliases?: string[],
];

const MAX_EXPANDED_LOCATION_TERMS = 48;

function buildSubdivisionEntries(
  region: LocationSearchRegion,
  subdivisions: SubdivisionTuple[]
): LocationDictionaryEntry[] {
  return subdivisions.map(([label, code, cities, extraAliases = []]) => ({
    label,
    region,
    aliases: [
      label.toLowerCase(),
      ...(region === "US" && code === "CA"
        ? []
        : [code.toLowerCase(), code.toLowerCase().split("").join(" ")]),
      ...extraAliases,
    ],
    containsTerms: [label, `, ${code}`, ...cities],
  }));
}

const COUNTRY_ENTRIES: LocationDictionaryEntry[] = [
  {
    label: "Canada",
    region: "CA",
    aliases: ["canada", "canadian", "remote canada", "remote in canada"],
    containsTerms: ["Canada"],
  },
  {
    label: "United States",
    region: "US",
    aliases: [
      "united states",
      "united states of america",
      "us",
      "u s",
      "usa",
      "u s a",
      "remote us",
      "remote usa",
      "remote united states",
      "remote in the united states",
    ],
    containsTerms: ["United States", "USA"],
  },
];

const SUBDIVISION_ENTRIES: LocationDictionaryEntry[] = [
  ...buildSubdivisionEntries("CA", [
    ["Alberta", "AB", ["Calgary", "Edmonton"]],
    ["British Columbia", "BC", ["Vancouver", "Victoria", "Burnaby", "Surrey", "Richmond", "Kelowna"]],
    ["Manitoba", "MB", ["Winnipeg"]],
    ["New Brunswick", "NB", ["Fredericton", "Moncton", "Saint John"]],
    ["Newfoundland and Labrador", "NL", ["St. John's"]],
    ["Northwest Territories", "NT", ["Yellowknife"]],
    ["Nova Scotia", "NS", ["Halifax"]],
    ["Nunavut", "NU", ["Iqaluit"]],
    [
      "Ontario",
      "ON",
      [
        "Toronto",
        "Ottawa",
        "Mississauga",
        "Brampton",
        "Hamilton",
        "Waterloo",
        "Kitchener",
        "London",
        "Markham",
        "Vaughan",
        "Richmond Hill",
        "Oakville",
        "Burlington",
      ],
      ["ont"],
    ],
    ["Prince Edward Island", "PE", ["Charlottetown"], ["pei"]],
    ["Quebec", "QC", ["Montreal", "Quebec City", "Laval", "Gatineau"]],
    ["Saskatchewan", "SK", ["Saskatoon", "Regina"]],
    ["Yukon", "YT", ["Whitehorse"]],
  ]),
  ...buildSubdivisionEntries("US", [
    ["Alabama", "AL", ["Birmingham", "Montgomery", "Huntsville"]],
    ["Alaska", "AK", ["Anchorage", "Juneau"]],
    ["Arizona", "AZ", ["Phoenix", "Scottsdale", "Tucson"]],
    ["Arkansas", "AR", ["Little Rock"]],
    [
      "California",
      "CA",
      [
        "San Francisco",
        "Los Angeles",
        "San Diego",
        "San Jose",
        "Sacramento",
        "Irvine",
        "Palo Alto",
        "Mountain View",
        "Santa Clara",
      ],
      ["calif"],
    ],
    ["Colorado", "CO", ["Denver", "Boulder"]],
    ["Connecticut", "CT", ["Hartford", "New Haven", "Stamford"]],
    ["Delaware", "DE", ["Wilmington"]],
    ["District of Columbia", "DC", ["Washington, DC", "Washington DC"], ["washington dc", "washington d c", "d c"]],
    ["Florida", "FL", ["Miami", "Orlando", "Tampa", "Jacksonville"]],
    ["Georgia", "GA", ["Atlanta"]],
    ["Hawaii", "HI", ["Honolulu"]],
    ["Idaho", "ID", ["Boise"]],
    ["Illinois", "IL", ["Chicago"]],
    ["Indiana", "IN", ["Indianapolis"]],
    ["Iowa", "IA", ["Des Moines"]],
    ["Kansas", "KS", ["Kansas City", "Overland Park", "Wichita"]],
    ["Kentucky", "KY", ["Louisville", "Lexington"]],
    ["Louisiana", "LA", ["New Orleans", "Baton Rouge"]],
    ["Maine", "ME", ["Portland"]],
    ["Maryland", "MD", ["Baltimore", "Bethesda"]],
    ["Massachusetts", "MA", ["Boston", "Cambridge"]],
    ["Michigan", "MI", ["Detroit", "Ann Arbor"]],
    ["Minnesota", "MN", ["Minneapolis", "Saint Paul"]],
    ["Mississippi", "MS", ["Jackson"]],
    ["Missouri", "MO", ["St. Louis", "Kansas City"]],
    ["Montana", "MT", ["Billings", "Bozeman"]],
    ["Nebraska", "NE", ["Omaha", "Lincoln"]],
    ["Nevada", "NV", ["Las Vegas", "Reno"]],
    ["New Hampshire", "NH", ["Manchester"]],
    ["New Jersey", "NJ", ["Jersey City", "Newark"]],
    ["New Mexico", "NM", ["Albuquerque", "Santa Fe"]],
    ["New York", "NY", ["New York", "NYC", "Brooklyn", "Buffalo", "Rochester", "Albany"]],
    ["North Carolina", "NC", ["Charlotte", "Raleigh", "Durham"]],
    ["North Dakota", "ND", ["Fargo", "Bismarck"]],
    ["Ohio", "OH", ["Columbus", "Cleveland", "Cincinnati"]],
    ["Oklahoma", "OK", ["Oklahoma City", "Tulsa"]],
    ["Oregon", "OR", ["Portland", "Eugene"]],
    ["Pennsylvania", "PA", ["Philadelphia", "Pittsburgh"]],
    ["Rhode Island", "RI", ["Providence"]],
    ["South Carolina", "SC", ["Charleston", "Columbia"]],
    ["South Dakota", "SD", ["Sioux Falls"]],
    ["Tennessee", "TN", ["Nashville", "Memphis"]],
    ["Texas", "TX", ["Austin", "Dallas", "Houston", "San Antonio"]],
    ["Utah", "UT", ["Salt Lake City"]],
    ["Vermont", "VT", ["Burlington"]],
    ["Virginia", "VA", ["Arlington", "Richmond", "Tysons"]],
    ["Washington", "WA", ["Seattle", "Bellevue", "Redmond"]],
    ["West Virginia", "WV", ["Charleston"]],
    ["Wisconsin", "WI", ["Milwaukee", "Madison"]],
    ["Wyoming", "WY", ["Cheyenne"]],
  ]),
];

const METRO_ENTRIES: LocationDictionaryEntry[] = [
  {
    label: "Greater Toronto Area",
    region: "CA",
    aliases: ["gta", "greater toronto area"],
    containsTerms: [
      "Toronto",
      "Mississauga",
      "Brampton",
      "Markham",
      "Vaughan",
      "Richmond Hill",
      "Oakville",
    ],
  },
  {
    label: "Bay Area",
    region: "US",
    aliases: ["bay area", "sf bay area", "san francisco bay area"],
    containsTerms: ["San Francisco", "Palo Alto", "Mountain View", "San Jose", "Santa Clara"],
  },
];

function normalizeLookupText(value: string) {
  return value
    .toLowerCase()
    .replace(/\bu\.s\.a?\b/g, " usa ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addUnique(values: string[], value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return;

  const key = trimmed.toLowerCase();
  if (values.some((existing) => existing.toLowerCase() === key)) return;
  values.push(trimmed);
}

function matchEntries(raw: string, entries: LocationDictionaryEntry[]) {
  const normalized = normalizeLookupText(raw);
  if (!normalized) return [];

  return entries.filter((entry) =>
    entry.aliases.some((alias) => {
      const normalizedAlias = normalizeLookupText(alias);
      return normalized === normalizedAlias;
    })
  );
}

/** Preserve city qualifiers; semicolons separate explicit alternative places. */
export function splitLocationSearchValues(value?: string | null): string[] {
  if (!value) return [];
  const result: string[] = [];
  for (const alternative of value.slice(0, 1000).split(";")) {
    let current = "";
    for (const raw of alternative.split(",")) {
      const part = raw.replace(/\s+/g, " ").trim();
      if (!part) continue;
      const qualifier = /^(?:CA|US|USA)$/i.test(part) || matchEntries(part, [...COUNTRY_ENTRIES, ...SUBDIVISION_ENTRIES]).length > 0;
      if (current && qualifier) current += `, ${part}`;
      else {
        if (current) addUnique(result, current);
        current = part;
      }
    }
    if (current) addUnique(result, current);
  }
  return result.slice(0, 10);
}

export function normalizeLocationSearch(value?: string | null) {
  return splitLocationSearchValues(value).join(";") || undefined;
}

type LocationWhere = {
  location?: { contains: string; mode: "insensitive" };
  region?: LocationSearchRegion;
  AND?: LocationWhere[];
  OR?: LocationWhere[];
};

/** Identical geographic predicates for the canonical pool, index and Picks. */
export function buildLocationSearchPredicate(value?: string | null): LocationWhere | null {
  const alternatives = splitLocationSearchValues(value).map((place) => {
    const parts = place.split(",").map((part) => part.trim());
    const constraints: LocationWhere[] = parts.map((part, index) => {
      const isCaliforniaCode = /^CA$/i.test(part);
      if (/^(?:US|USA)$/i.test(part)) return { region: "US" };
      if (isCaliforniaCode && index === parts.length - 1 && parts.length > 2) return { region: "CA" };
      const expanded = expandLocationSearchTerm(isCaliforniaCode ? "California" : part);
      if (expanded.region) return { region: expanded.region };
      const terms = expanded.containsTerms.length ? expanded.containsTerms : [part.length <= 2 ? `, ${part}` : part];
      const clauses: LocationWhere[] = terms.map((term) => ({ location: { contains: term.replace(/[%_\\]/g, "\\$&"), mode: "insensitive" } }));
      const textWhere = clauses.length === 1 ? clauses[0]! : { OR: clauses };
      const subdivision = matchEntries(isCaliforniaCode ? "California" : part, SUBDIVISION_ENTRIES)[0];
      return subdivision ? { AND: [{ region: subdivision.region }, textWhere] } : textWhere;
    });
    return constraints.length === 1 ? constraints[0]! : { AND: constraints };
  });
  return alternatives.length ? alternatives.length === 1 ? alternatives[0]! : { OR: alternatives } : null;
}

export function expandLocationSearchTerm(raw: string): ExpandedLocationSearchTerm {
  const normalizedRaw = raw.replace(/\s+/g, " ").trim();
  const countryMatches = matchEntries(normalizedRaw, COUNTRY_ENTRIES);
  const subdivisionMatches = matchEntries(normalizedRaw, SUBDIVISION_ENTRIES);
  const metroMatches = matchEntries(normalizedRaw, METRO_ENTRIES);
  const matchedEntries = [...countryMatches, ...subdivisionMatches, ...metroMatches];
  const containsTerms: string[] = [];
  const matchedLabels: string[] = [];

  for (const entry of matchedEntries) {
    addUnique(matchedLabels, entry.label);
    for (const term of entry.containsTerms) {
      addUnique(containsTerms, term);
    }
  }

  if (!matchedEntries.length && normalizedRaw.length >= 3) {
    addUnique(containsTerms, normalizedRaw);
  }

  const countryRegion = countryMatches[0]?.region ?? null;

  return {
    raw: normalizedRaw,
    region: countryRegion,
    containsTerms: containsTerms.slice(0, MAX_EXPANDED_LOCATION_TERMS),
    matchedLabels,
  };
}

export function inferLocationSearchRegion(value: string | null | undefined): LocationSearchRegion | null {
  if (!value) return null;
  return expandLocationSearchTerm(value).region;
}
