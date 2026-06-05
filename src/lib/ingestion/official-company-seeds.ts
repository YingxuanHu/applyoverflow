import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionRouteKind } from "@/generated/prisma/client";
import type { OfficialCompanyKey } from "@/lib/ingestion/connectors/official-company";

export const FIRST_PARTY_COMPANY_SEEDS_PATH = path.resolve(
  "data/discovery/seeds/first_party_company_seeds.csv"
);

export type FirstPartyCompanySeed = {
  rank: number;
  companyName: string;
  companyKey: string;
  careersUrl: string;
  regionPriority: string;
  priorityTier: number;
  whyImportant: string;
  notes: string;
};

export type FirstPartySeedDisposition =
  | {
      kind: "official_connector";
      company: OfficialCompanyKey;
      token: `${OfficialCompanyKey}:global`;
      connectorName: "official-company";
      sourceName: string;
      boardUrl: string;
      extractionRoute: Extract<ExtractionRouteKind, "STRUCTURED_API">;
      parserVersion: "official-company:v1";
      sourceType: "COMPANY_JSON";
      confidence: number;
      recommendation: "promote";
      reason: string;
    }
  | {
      kind: "deferred";
      recommendation: "needs_custom_connector" | "blocked";
      confidence: number;
      reason: string;
    }
  | {
      kind: "inspect_company_site";
      recommendation: "inspect";
      confidence: number;
      reason: string;
    };

export type FirstPartySeedSelection = {
  companies?: string[];
  priorityTier?: number;
  limit?: number;
};

const OFFICIAL_CONNECTOR_COMPANY_KEYS = new Map<
  string,
  { company: OfficialCompanyKey; boardUrl: string; reason: string }
>([
  [
    "microsoft",
    {
      company: "microsoft",
      boardUrl: "https://apply.careers.microsoft.com/careers",
      reason:
        "Microsoft exposes a first-party Eightfold PCSX search and position details API on its official careers host.",
    },
  ],
  [
    "nvidia",
    {
      company: "nvidia",
      boardUrl: "https://jobs.nvidia.com/careers",
      reason:
        "NVIDIA exposes a first-party Eightfold PCSX search and position details API on its official jobs host.",
    },
  ],
  [
    "amazon",
    {
      company: "amazon",
      boardUrl: "https://www.amazon.jobs",
      reason: "Amazon exposes a first-party search.json endpoint with direct job and apply URLs.",
    },
  ],
  [
    "bankofamerica",
    {
      company: "bankofamerica",
      boardUrl: "https://careers.bankofamerica.com/en-us/job-search",
      reason:
        "Bank of America exposes a first-party careers search servlet and job detail pages with stable requisition IDs and Workday apply URLs.",
    },
  ],
  [
    "google",
    {
      company: "google",
      boardUrl: "https://www.google.com/about/careers/applications/jobs/results/",
      reason:
        "Google exposes server-rendered official careers payloads with stable job IDs, locations, and apply URLs.",
    },
  ],
  [
    "homedepot",
    {
      company: "homedepot",
      boardUrl: "https://careers.homedepot.com/job-search-results/",
      reason:
        "Home Depot exposes an official CWS jobs API; the connector pulls the corporate/office subset to preserve the app's white-collar scope.",
    },
  ],
  [
    "starbucks",
    {
      company: "starbucks",
      boardUrl: "https://apply.starbucks.com/careers?domain=starbucks.com",
      reason:
        "Starbucks exposes a first-party Eightfold PCSX API; the connector shards office job categories and excludes retail/store postings.",
    },
  ],
  [
    "apple",
    {
      company: "apple",
      boardUrl: "https://jobs.apple.com",
      reason: "Apple exposes server-rendered structured search data with stable position IDs.",
    },
  ],
  [
    "netflix",
    {
      company: "netflix",
      boardUrl: "https://explore.jobs.netflix.net/careers?domain=netflix.com",
      reason:
        "Netflix exposes a first-party apply API and per-job detail endpoint on its official careers host.",
    },
  ],
]);

const DEFERRED_COMPANY_KEYS = new Map<
  string,
  { recommendation: "needs_custom_connector" | "blocked"; confidence: number; reason: string }
>([
  [
    "meta",
    {
      recommendation: "blocked",
      confidence: 0.3,
      reason:
        "Meta Careers has a prominent automated collection notice; keep it out of automated first-party ingestion until legal/robots handling is clarified.",
    },
  ],
  [
    "tesla",
    {
      recommendation: "blocked",
      confidence: 0.35,
      reason:
        "Tesla Careers is official and high-volume, but server-side fetches from the ingestion host are blocked by Akamai 403. Keep it out of generic company-site polling until a compliant custom connector or approved access path exists.",
    },
  ],
]);

export async function readFirstPartyCompanySeeds(
  filePath: string = FIRST_PARTY_COMPANY_SEEDS_PATH
): Promise<FirstPartyCompanySeed[]> {
  return parseFirstPartyCompanySeedCsv(await readFile(filePath, "utf8"));
}

export function parseFirstPartyCompanySeedCsv(csv: string): FirstPartyCompanySeed[] {
  const rows = parseCsvRows(csv).filter((row) => row.some((value) => value.trim()));
  const [header, ...records] = rows;
  if (!header) return [];

  const headerIndexes = new Map(header.map((name, index) => [name.trim(), index]));
  return records
    .map((row) => {
      const companyName = readCell(row, headerIndexes, "companyName");
      const companyKey = buildCompanyKey(companyName);
      return {
        rank: Number(readCell(row, headerIndexes, "rank")) || Number.MAX_SAFE_INTEGER,
        companyName,
        companyKey,
        careersUrl: readCell(row, headerIndexes, "careersUrl"),
        regionPriority: readCell(row, headerIndexes, "regionPriority"),
        priorityTier: Number(readCell(row, headerIndexes, "priorityTier")) || 3,
        whyImportant: readCell(row, headerIndexes, "whyImportant"),
        notes: readCell(row, headerIndexes, "notes"),
      };
    })
    .filter((seed) => seed.companyName && seed.companyKey && seed.careersUrl)
    .sort((left, right) => left.rank - right.rank);
}

export function selectFirstPartyCompanySeeds(
  seeds: FirstPartyCompanySeed[],
  selection: FirstPartySeedSelection = {}
) {
  const requestedCompanyKeys = new Set(
    (selection.companies ?? []).map((company) => buildCompanyKey(company)).filter(Boolean)
  );

  return seeds
    .filter((seed) => {
      if (selection.priorityTier && seed.priorityTier !== selection.priorityTier) {
        return false;
      }
      if (requestedCompanyKeys.size > 0 && !requestedCompanyKeys.has(seed.companyKey)) {
        return false;
      }
      return true;
    })
    .slice(0, Math.max(0, selection.limit ?? seeds.length));
}

export function classifyFirstPartyCompanySeed(
  seed: FirstPartyCompanySeed
): FirstPartySeedDisposition {
  const official = OFFICIAL_CONNECTOR_COMPANY_KEYS.get(seed.companyKey);
  if (official) {
    const token = `${official.company}:global` as const;
    return {
      kind: "official_connector",
      company: official.company,
      token,
      connectorName: "official-company",
      sourceName: `OfficialCompany:${officialCompanyDisplayName(official.company)}`,
      boardUrl: official.boardUrl,
      extractionRoute: "STRUCTURED_API",
      parserVersion: "official-company:v1",
      sourceType: "COMPANY_JSON",
      confidence: 0.98,
      recommendation: "promote",
      reason: official.reason,
    };
  }

  const deferred = DEFERRED_COMPANY_KEYS.get(seed.companyKey);
  if (deferred) {
    return {
      kind: "deferred",
      recommendation: deferred.recommendation,
      confidence: deferred.confidence,
      reason: deferred.reason,
    };
  }

  return {
    kind: "inspect_company_site",
    recommendation: "inspect",
    confidence: 0.5,
    reason: "No first-party connector exists yet; inspect the official careers URL for structured data.",
  };
}

export function splitCompanySelection(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function readCell(row: string[], headerIndexes: Map<string, number>, name: string) {
  const index = headerIndexes.get(name);
  return index == null ? "" : (row[index] ?? "").trim();
}

function buildCompanyKey(input: string) {
  return cleanCompanyName(input)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function cleanCompanyName(input: string) {
  return input
    .replace(/\s+-\s+/g, " ")
    .replace(/\b(?:inc|incorporated|corp|corporation|ltd|limited|llc|plc|co)\.?$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function officialCompanyDisplayName(company: OfficialCompanyKey) {
  if (company === "bankofamerica") return "Bank of America";
  if (company === "nvidia") return "NVIDIA";
  return company.charAt(0).toUpperCase() + company.slice(1);
}
