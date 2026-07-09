import type { Region } from "@/generated/prisma/client";

export type GeoScope =
  | "US"
  | "CA"
  | "NORTH_AMERICA"
  | "EUROPE"
  | "LATAM"
  | "APAC"
  | "MIDDLE_EAST_AFRICA"
  | "GLOBAL"
  | "UNKNOWN";

const NORTH_AMERICA_MARKERS = [
  "NORTH AMERICA",
  "AMERICAS",
  "US & CANADA",
  "US/CANADA",
  "US AND CANADA",
  "CANADA / US",
  "CANADA/US",
  "UNITED STATES OR CANADA",
];

const EUROPE_MARKERS = [
  "EUROPE",
  "EU",
  "EUROPEAN UNION",
  "UNITED KINGDOM",
  "UK",
  "IRELAND",
  "GERMANY",
  "FRANCE",
  "NETHERLANDS",
  "BELGIUM",
  "SPAIN",
  "ITALY",
  "POLAND",
  "SWEDEN",
  "DENMARK",
  "NORWAY",
  "FINLAND",
  "PORTUGAL",
  "SWITZERLAND",
  "AUSTRIA",
  "CZECH",
  "ROMANIA",
  "HUNGARY",
  "GREECE",
];

const LATAM_MARKERS = [
  "LATAM",
  "LATIN AMERICA",
  "MEXICO",
  "BRAZIL",
  "ARGENTINA",
  "CHILE",
  "COLOMBIA",
  "PERU",
  "URUGUAY",
  "COSTA RICA",
];

const APAC_MARKERS = [
  "APAC",
  "ASIA PACIFIC",
  "ASIA",
  "AUSTRALIA",
  "NEW ZEALAND",
  "INDIA",
  "JAPAN",
  "SINGAPORE",
  "KOREA",
  "HONG KONG",
  "TAIWAN",
  "PHILIPPINES",
  "MALAYSIA",
  "THAILAND",
  "VIETNAM",
  "INDONESIA",
];

const MEA_MARKERS = [
  "MIDDLE EAST",
  "AFRICA",
  "MEA",
  "EMEA",
  "UAE",
  "UNITED ARAB EMIRATES",
  "SAUDI ARABIA",
  "QATAR",
  "ISRAEL",
  "SOUTH AFRICA",
  "NIGERIA",
  "KENYA",
  "EGYPT",
];

export const OUT_OF_SCOPE_GEO_MARKERS = [
  ...EUROPE_MARKERS,
  ...LATAM_MARKERS,
  ...APAC_MARKERS,
  ...MEA_MARKERS,
] as const;

const GLOBAL_MARKERS = [
  "GLOBAL",
  "WORLDWIDE",
  "ANYWHERE",
  "EVERYWHERE",
];

export function inferGeoScope(location: string, region: Region | null): GeoScope {
  if (region === "US") return "US";
  if (region === "CA") return "CA";

  const normalizedLocation = location.toUpperCase();

  if (NORTH_AMERICA_MARKERS.some((marker) => normalizedLocation.includes(marker))) {
    return "NORTH_AMERICA";
  }
  if (GLOBAL_MARKERS.some((marker) => normalizedLocation.includes(marker))) {
    return "GLOBAL";
  }
  if (LATAM_MARKERS.some((marker) => normalizedLocation.includes(marker))) {
    return "LATAM";
  }
  if (APAC_MARKERS.some((marker) => normalizedLocation.includes(marker))) {
    return "APAC";
  }
  if (MEA_MARKERS.some((marker) => normalizedLocation.includes(marker))) {
    return "MIDDLE_EAST_AFRICA";
  }
  if (EUROPE_MARKERS.some((marker) => normalizedLocation.includes(marker))) {
    return "EUROPE";
  }

  return "UNKNOWN";
}

export function isExplicitlyOutOfScopeGeoScope(scope: GeoScope) {
  return (
    scope === "EUROPE" ||
    scope === "LATAM" ||
    scope === "APAC" ||
    scope === "MIDDLE_EAST_AFRICA"
  );
}

// ── North-America scope guard ────────────────────────────────────────────────
//
// US/CA marker sets shared with inferRegion (src/lib/ingestion/normalize.ts).
// They live here because geo-scope.ts is safe to import from client
// components, while normalize.ts transitively pulls in server-only modules.

export const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

export const US_STATE_NAMES = new Set([
  "ALABAMA",
  "ALASKA",
  "ARIZONA",
  "ARKANSAS",
  "CALIFORNIA",
  "COLORADO",
  "CONNECTICUT",
  "DELAWARE",
  "FLORIDA",
  "GEORGIA",
  "HAWAII",
  "IDAHO",
  "ILLINOIS",
  "INDIANA",
  "IOWA",
  "KANSAS",
  "KENTUCKY",
  "LOUISIANA",
  "MAINE",
  "MARYLAND",
  "MASSACHUSETTS",
  "MICHIGAN",
  "MINNESOTA",
  "MISSISSIPPI",
  "MISSOURI",
  "MONTANA",
  "NEBRASKA",
  "NEVADA",
  "NEW HAMPSHIRE",
  "NEW JERSEY",
  "NEW MEXICO",
  "NEW YORK",
  "NORTH CAROLINA",
  "NORTH DAKOTA",
  "OHIO",
  "OKLAHOMA",
  "OREGON",
  "PENNSYLVANIA",
  "RHODE ISLAND",
  "SOUTH CAROLINA",
  "SOUTH DAKOTA",
  "TENNESSEE",
  "TEXAS",
  "UTAH",
  "VERMONT",
  "VIRGINIA",
  "WASHINGTON",
  "WEST VIRGINIA",
  "WISCONSIN",
  "WYOMING",
  "DISTRICT OF COLUMBIA",
]);

export const CA_PROVINCE_CODES = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

export const CA_PROVINCE_NAMES = new Set([
  "ALBERTA",
  "BRITISH COLUMBIA",
  "MANITOBA",
  "NEW BRUNSWICK",
  "NEWFOUNDLAND AND LABRADOR",
  "NOVA SCOTIA",
  "NORTHWEST TERRITORIES",
  "NUNAVUT",
  "ONTARIO",
  "PRINCE EDWARD ISLAND",
  "QUEBEC",
  "SASKATCHEWAN",
  "YUKON",
]);

// Non-NA countries and regions beyond OUT_OF_SCOPE_GEO_MARKERS above; used
// only by the clearly-foreign detector, matched at word boundaries. Names
// that collide with NA place names (Georgia, Jordan, Lebanon, Panama, Malta,
// Cuba, Jamaica, Holland) are deliberately absent.
const ADDITIONAL_NON_NA_COUNTRY_MARKERS = [
  "SOUTH AMERICA",
  "ENGLAND",
  "SCOTLAND",
  "WALES",
  "NORTHERN IRELAND",
  "LUXEMBOURG",
  "CZECHIA",
  "CZECH REPUBLIC",
  "SLOVAKIA",
  "SLOVENIA",
  "CROATIA",
  "SERBIA",
  "BOSNIA",
  "ALBANIA",
  "CYPRUS",
  "BULGARIA",
  "UKRAINE",
  "LITHUANIA",
  "LATVIA",
  "ESTONIA",
  "ICELAND",
  "RUSSIA",
  "BELARUS",
  "KAZAKHSTAN",
  "UZBEKISTAN",
  "AZERBAIJAN",
  "ARMENIA",
  "MOLDOVA",
  "MONTENEGRO",
  "MACEDONIA",
  "KOSOVO",
  "TURKEY",
  "TURKIYE",
  "PAKISTAN",
  "BANGLADESH",
  "SRI LANKA",
  "NEPAL",
  "MYANMAR",
  "CAMBODIA",
  "LAOS",
  "MONGOLIA",
  "BRUNEI",
  "KUWAIT",
  "BAHRAIN",
  "OMAN",
  "IRAQ",
  "IRAN",
  "SYRIA",
  "YEMEN",
  "MOROCCO",
  "TUNISIA",
  "ALGERIA",
  "LIBYA",
  "GHANA",
  "ETHIOPIA",
  "UGANDA",
  "TANZANIA",
  "RWANDA",
  "SENEGAL",
  "IVORY COAST",
  "COTE D'IVOIRE",
  "CAMEROON",
  "ZIMBABWE",
  "ZAMBIA",
  "BOTSWANA",
  "MOZAMBIQUE",
  "ANGOLA",
  "PARAGUAY",
  "BOLIVIA",
  "ECUADOR",
  "VENEZUELA",
  "GUATEMALA",
  "HONDURAS",
  "NICARAGUA",
  "EL SALVADOR",
  "DOMINICAN REPUBLIC",
  "BELIZE",
  "HAITI",
  "FIJI",
];

// Well-known non-NA cities, matched at word boundaries against the
// diacritic-folded location. Only unambiguous names are listed: cities whose
// NA homonym is significant (Cambridge MA, Manchester NH, Birmingham AL,
// Vienna VA, Dublin OH, Rome GA, Athens GA, Geneva IL, Melbourne FL,
// Wellington FL, Lima OH, Moscow ID, Warsaw IN, Odessa TX, Florence AL,
// Venice CA, Alexandria VA, Panama City FL, Cali/Valencia CA, Jamaica NY,
// Lebanon PA, Hamburg NY, Rotterdam NY, ...) are omitted. Entries whose NA
// homonym is virtually always written with a state qualifier (Paris TX,
// Berlin NH, Cairo GA) are kept — the NA-qualifier check rescues those.
const NON_NA_CITY_MARKERS = [
  // UK & Ireland
  "LONDON",
  "EDINBURGH",
  "GLASGOW",
  "LEEDS",
  "LIVERPOOL",
  "SHEFFIELD",
  "NOTTINGHAM",
  "NEWCASTLE",
  "BELFAST",
  "CARDIFF",
  // France
  "PARIS",
  "LYON",
  "MARSEILLE",
  "TOULOUSE",
  "BORDEAUX",
  "NANTES",
  "LILLE",
  "STRASBOURG",
  "GRENOBLE",
  "MONTPELLIER",
  // DACH
  "BERLIN",
  "MUNICH",
  "FRANKFURT",
  "COLOGNE",
  "STUTTGART",
  "DUSSELDORF",
  "LEIPZIG",
  "DRESDEN",
  "NUREMBERG",
  "ZURICH",
  "BASEL",
  "LAUSANNE",
  "GRAZ",
  "SALZBURG",
  // Benelux
  "AMSTERDAM",
  "UTRECHT",
  "EINDHOVEN",
  "THE HAGUE",
  "BRUSSELS",
  "ANTWERP",
  "GHENT",
  // Iberia & Italy
  "MADRID",
  "BARCELONA",
  "SEVILLE",
  "BILBAO",
  "LISBON",
  "PORTO",
  "TURIN",
  "BOLOGNA",
  // Nordics & Baltics
  "STOCKHOLM",
  "GOTHENBURG",
  "MALMO",
  "OSLO",
  "COPENHAGEN",
  "AARHUS",
  "HELSINKI",
  "TAMPERE",
  "REYKJAVIK",
  "TALLINN",
  "RIGA",
  "VILNIUS",
  // Central & Eastern Europe
  "PRAGUE",
  "BRNO",
  "BRATISLAVA",
  "KRAKOW",
  "WROCLAW",
  "GDANSK",
  "POZNAN",
  "KATOWICE",
  "LODZ",
  "BUDAPEST",
  "BUCHAREST",
  "CLUJ",
  "SOFIA",
  "BELGRADE",
  "ZAGREB",
  "LJUBLJANA",
  "KYIV",
  "KIEV",
  "LVIV",
  "KHARKIV",
  "THESSALONIKI",
  // India
  "BANGALORE",
  "BENGALURU",
  "MUMBAI",
  "NEW DELHI",
  "HYDERABAD",
  "CHENNAI",
  "KOLKATA",
  "PUNE",
  "GURGAON",
  "GURUGRAM",
  "NOIDA",
  "AHMEDABAD",
  "JAIPUR",
  "KOCHI",
  "LUCKNOW",
  "INDORE",
  "NAGPUR",
  "COIMBATORE",
  "CHANDIGARH",
  "THIRUVANANTHAPURAM",
  // Indonesia
  "JAKARTA",
  "SURABAYA",
  "SEMARANG",
  "BANDUNG",
  "MEDAN",
  "DENPASAR",
  "YOGYAKARTA",
  "MAKASSAR",
  "BEKASI",
  "TANGERANG",
  // Philippines
  "MANILA",
  "CEBU",
  "QUEZON CITY",
  "MAKATI",
  "TAGUIG",
  "PASIG",
  "DAVAO",
  // Southeast Asia
  "KUALA LUMPUR",
  "PENANG",
  "BANGKOK",
  "CHIANG MAI",
  "HANOI",
  "HO CHI MINH",
  "DA NANG",
  "PHNOM PENH",
  // China, Japan, Korea, Taiwan
  "BEIJING",
  "SHANGHAI",
  "SHENZHEN",
  "GUANGZHOU",
  "HANGZHOU",
  "CHENGDU",
  "NANJING",
  "WUHAN",
  "SUZHOU",
  "TOKYO",
  "OSAKA",
  "KYOTO",
  "YOKOHAMA",
  "NAGOYA",
  "FUKUOKA",
  "SEOUL",
  "BUSAN",
  "INCHEON",
  "TAIPEI",
  "HSINCHU",
  // South Asia (non-India)
  "KARACHI",
  "LAHORE",
  "ISLAMABAD",
  "RAWALPINDI",
  "DHAKA",
  "CHITTAGONG",
  "COLOMBO",
  "KATHMANDU",
  // Middle East & Turkey
  "DUBAI",
  "ABU DHABI",
  "SHARJAH",
  "RIYADH",
  "JEDDAH",
  "DOHA",
  "TEL AVIV",
  "JERUSALEM",
  "HAIFA",
  "ISTANBUL",
  "ANKARA",
  "IZMIR",
  "AMMAN",
  "BEIRUT",
  "CAIRO",
  // Africa
  "LAGOS",
  "ABUJA",
  "NAIROBI",
  "ACCRA",
  "KAMPALA",
  "ADDIS ABABA",
  "DAR ES SALAAM",
  "CAPE TOWN",
  "JOHANNESBURG",
  "PRETORIA",
  "DURBAN",
  "CASABLANCA",
  "TUNIS",
  "KIGALI",
  // Latin America
  "MEXICO CITY",
  "GUADALAJARA",
  "MONTERREY",
  "TIJUANA",
  "SAO PAULO",
  "RIO DE JANEIRO",
  "BELO HORIZONTE",
  "PORTO ALEGRE",
  "CURITIBA",
  "BRASILIA",
  "RECIFE",
  "BUENOS AIRES",
  "SANTIAGO",
  "BOGOTA",
  "MEDELLIN",
  "MONTEVIDEO",
  "QUITO",
  "GUAYAQUIL",
  "CARACAS",
  "SANTO DOMINGO",
  // Oceania
  "SYDNEY",
  "BRISBANE",
  "ADELAIDE",
  "CANBERRA",
  "AUCKLAND",
  "CHRISTCHURCH",
];

// Foreign first-level administrative regions (states/provinces) that are
// unambiguous versus NA place names. These are STRONG evidence: ATS feeds
// commonly emit "City, Region, CC" where the trailing two-letter country
// code collides with a US state code ("Jakarta Selatan, DKI Jakarta, ID"
// reads ID as Idaho; "Bengaluru, KA, IN" reads IN as Indiana — production
// had thousands of foreign rows stamped US/CA this way). Names colliding
// with NA places (Victoria, Ontario) are deliberately absent.
const FOREIGN_ADMIN_REGION_MARKERS = [
  "DKI JAKARTA",
  "JAKARTA RAYA",
  "WEST JAVA",
  "EAST JAVA",
  "JAWA BARAT",
  "KARNATAKA",
  "MAHARASHTRA",
  "TAMIL NADU",
  "TELANGANA",
  "GUJARAT",
  "RAJASTHAN",
  "MADHYA PRADESH",
  "UTTAR PRADESH",
  "ANDHRA PRADESH",
  "WEST BENGAL",
  "KERALA",
  "HARYANA",
  "EASTERN PROVINCE",
  "MECCA PROVINCE",
  "MEDINA PROVINCE",
  "RIYADH PROVINCE",
  "NEW SOUTH WALES",
  "QUEENSLAND",
  "BAVARIA",
  "BADEN-WURTTEMBERG",
  "ILE-DE-FRANCE",
  "CATALONIA",
  "ANDALUSIA",
  "LOMBARDY",
  "GAUTENG",
  "MINDANAO",
  "LUZON",
];

// Country codes accepted only as standalone comma-separated segments
// ("Warsaw, PL"). Codes that collide with US state or CA province codes
// (DE, IN, ID, IL, CO, AR, LA, MA, MN, MT, NE, PA, SC, SD, TN, NL, PE, SK,
// BC, ON, ...) or with common non-geographic tokens (IT, NO, MY) are
// deliberately absent.
const NON_NA_COUNTRY_CODE_SEGMENTS = new Set([
  "GB",
  "GBR",
  "FR",
  "FRA",
  "DEU",
  "ES",
  "ESP",
  "PT",
  "PRT",
  "ITA",
  "NLD",
  "BE",
  "BEL",
  "CH",
  "CHE",
  "AT",
  "AUT",
  "IE",
  "IRL",
  "PL",
  "POL",
  "CZ",
  "CZE",
  "SVK",
  "HU",
  "HUN",
  "RO",
  "ROU",
  "BG",
  "BGR",
  "GR",
  "GRC",
  "HR",
  "HRV",
  "RS",
  "SRB",
  "SI",
  "SVN",
  "LT",
  "LTU",
  "LV",
  "LVA",
  "EE",
  "EST",
  "SE",
  "SWE",
  "DK",
  "DNK",
  "FI",
  "FIN",
  "NOR",
  "ISL",
  "UA",
  "UKR",
  "RU",
  "RUS",
  "TR",
  "TUR",
  "AE",
  "ARE",
  "SA",
  "SAU",
  "QA",
  "QAT",
  "ISR",
  "EG",
  "EGY",
  "KE",
  "KEN",
  "NGA",
  "GH",
  "GHA",
  "ZA",
  "ZAF",
  "PH",
  "PHL",
  "SG",
  "SGP",
  "TH",
  "THA",
  "VN",
  "VNM",
  "MYS",
  "IDN",
  "JP",
  "JPN",
  "CN",
  "CHN",
  "TW",
  "TWN",
  "HK",
  "HKG",
  "KR",
  "KOR",
  "PK",
  "PAK",
  "BD",
  "BGD",
  "LK",
  "LKA",
  "AU",
  "NZ",
  "NZL",
  "BR",
  "BRA",
  "MX",
  "MEX",
  "CL",
  "CHL",
  "UY",
  "URY",
  "EC",
  "ECU",
  "VE",
  "VEN",
]);

// Any US/CA qualifier anywhere in the string proves the location is not
// clearly foreign ("Paris, TX", "London, Ontario", "Remote - New Mexico").
const NA_QUALIFIER_MARKERS = [
  "UNITED STATES",
  "USA",
  "U.S.",
  "U.S.A.",
  "CANADA",
  ...NORTH_AMERICA_MARKERS,
  ...US_STATE_NAMES,
  ...CA_PROVINCE_NAMES,
];

// State/province codes are too collision-prone for word-boundary matching in
// free text; they count as NA qualifiers only as exact comma segments
// ("London, ON").
const NA_QUALIFIER_CODE_SEGMENTS = new Set([
  ...US_STATE_CODES,
  ...CA_PROVINCE_CODES,
  "US",
  "USA",
  "CAN",
]);

function foldLocationText(location: string): string {
  return location
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches any marker as a standalone word: not embedded inside a longer
// alphabetic token ("EU" must not match "EUGENE", "INDIA" must not match
// "INDIANAPOLIS").
function buildStandaloneMarkerPattern(markers: readonly string[]): RegExp {
  const alternation = markers.map(escapeForRegExp).join("|");
  return new RegExp(`(?<![A-Z])(?:${alternation})(?![A-Z])`);
}

const NA_QUALIFIER_PATTERN = buildStandaloneMarkerPattern(NA_QUALIFIER_MARKERS);
// STRONG foreign evidence (country + admin-region names, and collision-free
// country-code segments) outranks NA state/province CODE segments; weak
// evidence (city names) does not — so "Paris, TX" stays American while
// "Jakarta Selatan, DKI Jakarta, ID" cannot hide behind Idaho's code.
const STRONG_NON_NA_MARKER_PATTERN = buildStandaloneMarkerPattern([
  ...OUT_OF_SCOPE_GEO_MARKERS,
  ...ADDITIONAL_NON_NA_COUNTRY_MARKERS,
  ...FOREIGN_ADMIN_REGION_MARKERS,
]);
const WEAK_NON_NA_MARKER_PATTERN = buildStandaloneMarkerPattern([
  ...NON_NA_CITY_MARKERS,
]);

function splitCommaSegments(folded: string): string[] {
  return folded
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

// Conservative detector for locations that explicitly name a non-NA
// geography. Callers apply it only after inferRegion (normalize.ts) resolved
// no region — a US/CA region always wins — and any US/CA qualifier inside
// the string itself also wins. When in doubt this returns false: ambiguous
// values ("Remote", "", "Sales Department", bare "Toronto") are never
// flagged.
// Strong foreign evidence: unambiguous country/admin-region names or
// collision-free country-code segments, unless an explicit NA NAME
// (country/state/province spelled out — not a two-letter code) appears.
// Exported for inferRegion (normalize.ts), whose city-marker and
// trailing-code parsing must not run on strings that name a foreign
// geography outright.
export function hasStrongNonNorthAmericanGeoEvidence(location: string): boolean {
  const folded = foldLocationText(location);
  if (!folded) return false;

  if (NA_QUALIFIER_PATTERN.test(folded)) return false;
  if (STRONG_NON_NA_MARKER_PATTERN.test(folded)) return true;

  return splitCommaSegments(folded).some((segment) =>
    NON_NA_COUNTRY_CODE_SEGMENTS.has(segment)
  );
}

export function isClearlyNonNorthAmericanLocation(location: string): boolean {
  const folded = foldLocationText(location);
  if (!folded) return false;

  if (NA_QUALIFIER_PATTERN.test(folded)) return false;

  // Strong evidence beats NA state/province CODE segments: two-letter codes
  // collide with country codes (ID/IN/DE), so a spelled-out foreign country
  // or admin region wins over them.
  if (STRONG_NON_NA_MARKER_PATTERN.test(folded)) return true;

  const segments = splitCommaSegments(folded);
  if (segments.some((segment) => NON_NA_COUNTRY_CODE_SEGMENTS.has(segment))) {
    return true;
  }

  // NA code segments beat weak (city-name) evidence, keeping "Paris, TX"
  // and "London, ON" American.
  if (segments.some((segment) => NA_QUALIFIER_CODE_SEGMENTS.has(segment))) {
    return false;
  }

  return WEAK_NON_NA_MARKER_PATTERN.test(folded);
}

export function formatGeoScopeLabel(scope: GeoScope) {
  switch (scope) {
    case "US":
      return "US";
    case "CA":
      return "Canada";
    case "NORTH_AMERICA":
      return "North America";
    case "EUROPE":
      return "Europe";
    case "LATAM":
      return "Latin America";
    case "APAC":
      return "APAC";
    case "MIDDLE_EAST_AFRICA":
      return "MEA";
    case "GLOBAL":
      return "Global";
    default:
      return "Unknown";
  }
}
