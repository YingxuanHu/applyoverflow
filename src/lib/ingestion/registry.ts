import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createAdzunaConnector,
  createAshbyConnector,
  createGreenhouseConnector,
  createHimalayasConnector,
  createIcimsConnector,
  createJobicyConnector,
  createJoobleConnector,
  createJobviteConnector,
  createTeamtailorConnector,
  createLeverConnector,
  createBreezyHrConnector,
  createHireologyConnector,
  createHrSmartConnector,
  createJobBankLiveConnector,
  createJSearchConnector,
  createOfficialCompanyConnector,
  createParadoxConnector,
  parseOfficialCompanySourceToken,
  createMuseConnector,
  createOracleCloudConnector,
  createRemotiveConnector,
  createWorkAtAStartupConnector,
  createRecruiteeConnector,
  createRemoteOkConnector,
  createRipplingConnector,
  createSuccessFactorsConnector,
  createSmartRecruitersConnector,
  createTaleoConnector,
  createUsaJobsBatchConnectors,
  createUsaJobsConnector,
  createWorkdayConnector,
  createWorkableConnector,
  createJobBankConnector,
  createWeWorkRemotelyConnector,
} from "@/lib/ingestion/connectors";
import {
  ASHBY_DEFAULT_ORG_TOKENS,
  GREENHOUSE_DEFAULT_BOARD_TOKENS,
  ICIMS_DEFAULT_PORTAL_TOKENS,
  JOBVITE_DEFAULT_COMPANY_TOKENS,
  LEVER_DEFAULT_SITE_TOKENS,
  RECRUITEE_DEFAULT_COMPANY_TOKENS,
  RIPPLING_DEFAULT_BOARD_TOKENS,
  SMARTRECRUITERS_DEFAULT_COMPANY_TOKENS,
  TALEO_DEFAULT_SOURCE_TOKENS,
  TEAMTAILOR_DEFAULT_COMPANY_TOKENS,
  WORKABLE_DEFAULT_ACCOUNT_TOKENS,
} from "@/lib/ingestion/coverage";
import {
  assertSourceFamilyEnabled,
  isSourceFamilyEnabled,
  readCsvEnv,
} from "@/lib/ingestion/source-family-config";
import { readBooleanEnv } from "@/lib/ingestion/capacity";
import type { SourceConnector } from "@/lib/ingestion/types";

export type SupportedConnectorName =
  | "adzuna"
  | "ashby"
  | "greenhouse"
  | "himalayas"
  | "icims"
  | "jobicy"
  | "jooble"
  | "jobvite"
  | "teamtailor"
  | "breezyhr"
  | "hireology"
  | "hrsmart"
  | "jsearch"
  | "lever"
  | "paradox"
  | "oraclecloud"
  | "remotive"
  | "workatastartup"
  | "themuse"
  | "recruitee"
  | "remoteok"
  | "rippling"
  | "successfactors"
  | "smartrecruiters"
  | "taleo"
  | "usajobs"
  | "workday"
  | "workable"
  | "jobbank"
  | "jobbank-live"
  | "official-company"
  | "weworkremotely";

export type ConnectorResolutionArgs = {
  board?: string;
  boards?: string;
  org?: string;
  orgs?: string;
  site?: string;
  sites?: string;
  company?: string;
  companies?: string;
  domain?: string;
  domains?: string;
  source?: string;
  sources?: string;
  account?: string;
  accounts?: string;
};

export type ScheduledConnectorDefinition = {
  cadenceMinutes: number;
  connector: SourceConnector;
};

type DiscoveryStore = {
  entries?: Array<{
    connectorName?: SupportedConnectorName;
    token?: string;
    status?: "pending" | "rejected" | "promoted";
  }>;
};

// ─── Defaults ─────────────────────────────────────────────────────────────────
// Comma-separated board/site/org tokens. Override via env vars for production.

const DEFAULT_GREENHOUSE_BOARDS = GREENHOUSE_DEFAULT_BOARD_TOKENS.join(",");

const DEFAULT_LEVER_SITES = LEVER_DEFAULT_SITE_TOKENS.join(",");

const DEFAULT_RECRUITEE_COMPANIES = RECRUITEE_DEFAULT_COMPANY_TOKENS.join(",");

const DEFAULT_RIPPLING_BOARDS = RIPPLING_DEFAULT_BOARD_TOKENS.join(",");

const DEFAULT_ASHBY_ORGS = ASHBY_DEFAULT_ORG_TOKENS.join(",");

const DEFAULT_JOBVITE_COMPANIES = JOBVITE_DEFAULT_COMPANY_TOKENS.join(",");

const DEFAULT_TEAMTAILOR_COMPANIES = TEAMTAILOR_DEFAULT_COMPANY_TOKENS.join(",");

const DEFAULT_TALEO_SOURCES = TALEO_DEFAULT_SOURCE_TOKENS.join(",");

const DISCOVERY_STORE_PATH = path.resolve(
  process.cwd(),
  "data/discovery/source-candidates.json"
);

// ─── Resolver ────────────────────────────────────────────────────────────────

export function resolveConnectors(
  connectorName: SupportedConnectorName,
  args: ConnectorResolutionArgs
): SourceConnector[] {
  assertSourceFamilyEnabled(connectorName);

  if (connectorName === "adzuna") {
    const countries = resolveTokens(
      args.sources ?? args.source ?? process.env.ADZUNA_COUNTRIES ?? "ca,us"
    );
    return countries.map((token) => {
      const [country, profile] = token.split(":");
      return createAdzunaConnector({ country, profile });
    });
  }

  if (connectorName === "himalayas") {
    const profiles = resolveTokens(
      args.sources ?? args.source ?? process.env.HIMALAYAS_SOURCES ?? "global"
    );
    return profiles.map((profile) => createHimalayasConnector({ profile }));
  }

  if (connectorName === "jobicy") {
    return [createJobicyConnector()];
  }

  if (connectorName === "jooble") {
    const profiles = resolveTokens(
      args.sources ?? args.source ?? process.env.JOOBLE_PROFILES ?? "feed"
    );
    return profiles.map((profile) => createJoobleConnector({ profile }));
  }

  if (connectorName === "workatastartup") {
    return [createWorkAtAStartupConnector()];
  }

  if (connectorName === "jsearch") {
    return [createJSearchConnector()];
  }

  if (connectorName === "jobbank-live") {
    return [createJobBankLiveConnector()];
  }

  if (connectorName === "official-company") {
    const sourceTokens = resolveTokens(
      args.companies ??
        args.company ??
        args.sources ??
        args.source ??
        process.env.OFFICIAL_COMPANY_SOURCES ??
        "amazon:global,google:global,apple:global,microsoft:global,nvidia:global,netflix:global,bankofamerica:global,homedepot:global,starbucks:north-america"
    );

    return sourceTokens.map((sourceToken) =>
      createOfficialCompanyConnector(parseOfficialCompanySourceToken(sourceToken))
    );
  }

  if (connectorName === "breezyhr") {
    const companies = resolveTokens(
      args.companies ?? args.company ?? process.env.BREEZYHR_COMPANIES ?? ""
    );
    return companies
      .map((company) => {
        try {
          return createBreezyHrConnector({ company });
        } catch {
          return null;
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);
  }

  if (connectorName === "hireology") {
    const slugs = resolveTokens(
      args.sources ?? args.source ?? process.env.HIREOLOGY_SLUGS ?? ""
    );
    return slugs
      .map((slug) => {
        try {
          return createHireologyConnector({ slug });
        } catch {
          return null;
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);
  }

  if (connectorName === "paradox") {
    return resolveJsonLdBoardTokenList("PARADOX_TENANTS")
      .map(({ tenant, boardUrl }) => {
        try {
          return createParadoxConnector({ tenant, boardUrl });
        } catch {
          return null;
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);
  }

  if (connectorName === "hrsmart") {
    return resolveJsonLdBoardTokenList("HRSMART_TENANTS")
      .map(({ tenant, boardUrl }) => {
        try {
          return createHrSmartConnector({ tenant, boardUrl });
        } catch {
          return null;
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);
  }

  if (connectorName === "oraclecloud") {
    const tokens = resolveTokens(
      args.sources ?? args.source ?? process.env.ORACLECLOUD_TENANTS ?? ""
    );
    return tokens
      .map((token) => {
        const [tenant, site] = token.split("|");
        if (!tenant || !/\.oraclecloud\.com$/i.test(tenant)) return null;
        try {
          return createOracleCloudConnector({
            tenant,
            site: site?.trim() || "CX",
          });
        } catch {
          return null;
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);
  }

  if (connectorName === "jobvite") {
    const companyTokens = resolveTokens(
      args.companies ??
        args.company ??
        process.env.JOBVITE_COMPANY_TOKENS ??
        DEFAULT_JOBVITE_COMPANIES
    );

    if (companyTokens.length === 0) {
      throw new Error(
        "No Jobvite companies configured. Pass --company=ornge or set JOBVITE_COMPANY_TOKENS."
      );
    }

    return companyTokens.map((companyToken) =>
      createJobviteConnector({ companyToken })
    );
  }

  if (connectorName === "teamtailor") {
    const companyTokens = resolveTokens(
      args.companies ??
        args.company ??
        process.env.TEAMTAILOR_COMPANY_TOKENS ??
        DEFAULT_TEAMTAILOR_COMPANIES
    );

    if (companyTokens.length === 0) {
      throw new Error(
        "No Teamtailor companies configured. Pass --company=ecoonline or set TEAMTAILOR_COMPANY_TOKENS."
      );
    }

    return companyTokens.map((companyToken) =>
      createTeamtailorConnector({ companyToken })
    );
  }

  if (connectorName === "remotive") {
    return [createRemotiveConnector()];
  }

  if (connectorName === "themuse") {
    return [createMuseConnector()];
  }

  if (connectorName === "remoteok") {
    return [createRemoteOkConnector()];
  }

  if (connectorName === "weworkremotely") {
    return [createWeWorkRemotelyConnector()];
  }

  if (connectorName === "usajobs") {
    const keywords = resolveTokens(
      args.sources ?? args.source ?? process.env.USAJOBS_KEYWORDS ?? ""
    );
    if (keywords.length === 0) {
      // Single broad connector
      return [createUsaJobsConnector()];
    }
    return keywords.map((keyword) => createUsaJobsConnector({ keyword }));
  }

  if (connectorName === "ashby") {
    const orgTokens = resolveTokens(
      args.orgs ?? args.org ?? process.env.ASHBY_ORG_TOKENS ?? DEFAULT_ASHBY_ORGS
    );

    if (orgTokens.length === 0) {
      throw new Error(
        "No Ashby orgs configured. Pass --org=notion or set ASHBY_ORG_TOKENS."
      );
    }

    return orgTokens.map((orgSlug) => createAshbyConnector({ orgSlug }));
  }

  if (connectorName === "greenhouse") {
    const boardTokens = resolveTokens(
      args.boards ??
        args.board ??
        process.env.GREENHOUSE_BOARD_TOKENS ??
        DEFAULT_GREENHOUSE_BOARDS
    );

    if (boardTokens.length === 0) {
      throw new Error(
        "No Greenhouse boards configured. Pass --board=vercel or set GREENHOUSE_BOARD_TOKENS."
      );
    }

    return boardTokens.map((boardToken) => createGreenhouseConnector({ boardToken }));
  }

  if (connectorName === "lever") {
    const siteTokens = resolveTokens(
      args.sites ??
        args.site ??
        process.env.LEVER_SITE_TOKENS ??
        DEFAULT_LEVER_SITES
    );

    if (siteTokens.length === 0) {
      throw new Error(
        "No Lever sites configured. Pass --site=plaid or set LEVER_SITE_TOKENS."
      );
    }

    return siteTokens.map((siteToken) => createLeverConnector({ siteToken }));
  }

  if (connectorName === "recruitee") {
    const companyTokens = resolveTokens(
      args.companies ??
        args.company ??
        process.env.RECRUITEE_COMPANY_TOKENS ??
        DEFAULT_RECRUITEE_COMPANIES
    );

    if (companyTokens.length === 0) {
      throw new Error(
        "No Recruitee companies configured. Pass --company=deephealth or set RECRUITEE_COMPANY_TOKENS."
      );
    }

    return companyTokens.map((companyIdentifier) =>
      createRecruiteeConnector({ companyIdentifier })
    );
  }

  if (connectorName === "rippling") {
    const boardTokens = resolveTokens(
      args.boards ??
        args.board ??
        process.env.RIPPLING_BOARD_TOKENS ??
        DEFAULT_RIPPLING_BOARDS
    );

    if (boardTokens.length === 0) {
      throw new Error(
        "No Rippling boards configured. Pass --board=rippling or set RIPPLING_BOARD_TOKENS."
      );
    }

    return boardTokens.map((boardSlug) => createRipplingConnector({ boardSlug }));
  }

  if (connectorName === "successfactors") {
    const domainTokens = resolveTokens(
      args.domains ??
        args.domain ??
        process.env.SUCCESSFACTORS_DOMAIN_TOKENS ??
        ""
    );

    if (domainTokens.length === 0) {
      throw new Error(
        "No SuccessFactors domains configured. Pass --domain=jobs.sap.com or set SUCCESSFACTORS_DOMAIN_TOKENS."
      );
    }

    return domainTokens.map((sourceToken) =>
      createSuccessFactorsConnector({ sourceToken })
    );
  }

  if (connectorName === "workable") {
    const accountTokens = resolveTokens(
      args.accounts ??
        args.account ??
        process.env.WORKABLE_ACCOUNT_TOKENS ??
        WORKABLE_DEFAULT_ACCOUNT_TOKENS.join(",")
    );

    if (accountTokens.length === 0) {
      throw new Error(
        "No Workable accounts configured. Pass --account=fairmoney or set WORKABLE_ACCOUNT_TOKENS."
      );
    }

    return accountTokens.map((accountToken) =>
      createWorkableConnector({ accountToken })
    );
  }

  if (connectorName === "icims") {
    const portalTokens = resolveTokens(
      args.sources ??
        args.source ??
        process.env.ICIMS_PORTAL_TOKENS ??
        ICIMS_DEFAULT_PORTAL_TOKENS.join(",")
    );

    if (portalTokens.length === 0) {
      throw new Error(
        "No iCIMS portals configured. Pass --source=jobs-microsoft or set ICIMS_PORTAL_TOKENS."
      );
    }

    return portalTokens.map((portalSubdomain) =>
      createIcimsConnector({ portalSubdomain })
    );
  }

  if (connectorName === "taleo") {
    const sourceTokens = resolveTokens(
      args.sources ??
        args.source ??
        process.env.TALEO_SOURCE_TOKENS ??
        DEFAULT_TALEO_SOURCES
    );

    if (sourceTokens.length === 0) {
      throw new Error(
        "No Taleo sources configured. Pass --source=tenant/section or set TALEO_SOURCE_TOKENS."
      );
    }

    return sourceTokens.map((sourceToken) =>
      createTaleoConnector({ sourceToken })
    );
  }

  if (connectorName === "workday") {
    const sourceTokens = resolveTokens(
      args.sources ??
        args.source ??
        process.env.WORKDAY_SOURCE_TOKENS ??
        ""
    );

    if (sourceTokens.length === 0) {
      throw new Error(
        "No Workday sources configured. Pass --source=host|tenant|site or set WORKDAY_SOURCE_TOKENS."
      );
    }

    return sourceTokens.map((sourceToken) =>
      createWorkdayConnector({ sourceToken })
    );
  }

  if (connectorName === "jobbank") {
    return [createJobBankConnector()];
  }

  // smartrecruiters
  const companyTokens = resolveTokens(
    args.companies ??
      args.company ??
      process.env.SMARTRECRUITERS_COMPANY_TOKENS ??
      SMARTRECRUITERS_DEFAULT_COMPANY_TOKENS.join(",")
  );

  if (companyTokens.length === 0) {
    throw new Error(
      "No SmartRecruiters companies configured. Pass --company=visa or set SMARTRECRUITERS_COMPANY_TOKENS."
    );
  }

  return companyTokens.map((companyIdentifier) =>
    createSmartRecruitersConnector({ companyIdentifier })
  );
}

// ─── Scheduled connector list ─────────────────────────────────────────────────

export function getScheduledConnectors(): ScheduledConnectorDefinition[] {
  const promotedDiscoveryTargets = loadPromotedDiscoveryTargets();

  return [
    ...resolveScheduledFamily("ashby", () =>
      resolveConnectors("ashby", {
        orgs: mergeTokenValues(
          process.env.ASHBY_ORG_TOKENS ?? DEFAULT_ASHBY_ORGS,
          promotedDiscoveryTargets.ashby
        ),
      }).map((connector) => ({
        connector,
        cadenceMinutes: resolveCadenceMinutes(
          process.env.ASHBY_SCHEDULE_MINUTES,
          120
        ),
      }))
    ),
    ...resolveScheduledFamily("greenhouse", () =>
      resolveConnectors("greenhouse", {
        boards: mergeTokenValues(
          process.env.GREENHOUSE_BOARD_TOKENS ?? DEFAULT_GREENHOUSE_BOARDS,
          promotedDiscoveryTargets.greenhouse
        ),
      }).map((connector) => ({
        connector,
        cadenceMinutes: resolveCadenceMinutes(
          process.env.GREENHOUSE_SCHEDULE_MINUTES,
          180
        ),
      }))
    ),
    ...resolveScheduledFamily("lever", () =>
      resolveConnectors("lever", {
        sites: mergeTokenValues(
          process.env.LEVER_SITE_TOKENS ?? DEFAULT_LEVER_SITES,
          promotedDiscoveryTargets.lever
        ),
      }).map((connector) => ({
        connector,
        cadenceMinutes: resolveCadenceMinutes(
          process.env.LEVER_SCHEDULE_MINUTES,
          120
        ),
      }))
    ),
    ...resolveScheduledFamily("recruitee", () =>
      resolveConnectors("recruitee", {
        companies: mergeTokenValues(
          process.env.RECRUITEE_COMPANY_TOKENS ?? DEFAULT_RECRUITEE_COMPANIES,
          promotedDiscoveryTargets.recruitee
        ),
      }).map((connector) => ({
        connector,
        cadenceMinutes: resolveCadenceMinutes(
          process.env.RECRUITEE_SCHEDULE_MINUTES,
          180
        ),
      }))
    ),
    ...resolveScheduledFamily("rippling", () =>
      resolveConnectors("rippling", {
        boards: mergeTokenValues(
          process.env.RIPPLING_BOARD_TOKENS ?? DEFAULT_RIPPLING_BOARDS,
          promotedDiscoveryTargets.rippling
        ),
      }).map((connector) => ({
        connector,
        cadenceMinutes: resolveCadenceMinutes(
          process.env.RIPPLING_SCHEDULE_MINUTES,
          180
        ),
      }))
    ),
    ...resolveOptionalSuccessFactorsScheduledConnectors(
      promotedDiscoveryTargets.successfactors
    ),
    ...resolveOptionalSmartRecruitersScheduledConnectors(
      promotedDiscoveryTargets.smartrecruiters
    ),
    ...resolveOptionalWorkableScheduledConnectors(
      promotedDiscoveryTargets.workable
    ),
    ...resolveOptionalJobviteScheduledConnectors(promotedDiscoveryTargets.jobvite),
    ...resolveOptionalTeamtailorScheduledConnectors(
      promotedDiscoveryTargets.teamtailor
    ),
    ...resolveOptionalWorkdayScheduledConnectors(promotedDiscoveryTargets.workday),
    ...resolveOptionalAdzunaScheduledConnectors(),
    ...resolveOptionalHimalayasScheduledConnectors(),
    ...resolveOptionalJobicyScheduledConnectors(),
    ...resolveOptionalJoobleScheduledConnectors(),
    ...resolveOptionalRemotiveScheduledConnectors(),
    ...resolveOptionalMuseScheduledConnectors(),
    ...resolveOptionalRemoteOkScheduledConnectors(),
    ...resolveOptionalWeWorkRemotelyScheduledConnectors(),
    ...resolveOptionalUsaJobsScheduledConnectors(),
    ...resolveOptionalTaleoScheduledConnectors(promotedDiscoveryTargets.taleo),
    ...resolveOptionalIcimsScheduledConnectors(promotedDiscoveryTargets.icims),
    ...resolveOptionalJobBankScheduledConnectors(),
    ...resolveOptionalOracleCloudScheduledConnectors(),
    ...resolveOptionalWorkAtAStartupScheduledConnectors(),
    ...resolveOptionalJSearchScheduledConnectors(),
    ...resolveOptionalBreezyHrScheduledConnectors(),
    ...resolveOptionalHireologyScheduledConnectors(),
    ...resolveOptionalParadoxScheduledConnectors(),
    ...resolveOptionalHrSmartScheduledConnectors(),
    ...resolveOptionalJobBankLiveScheduledConnectors(),
    ...resolveScheduledFamily("official-company", () =>
      resolveConnectors("official-company", {
        sources:
          process.env.OFFICIAL_COMPANY_SOURCES ??
          "amazon:global,google:global,apple:global,microsoft:global,nvidia:global,netflix:global,bankofamerica:global,homedepot:global,starbucks:north-america",
      }).map((connector) => ({
        connector,
        cadenceMinutes: resolveCadenceMinutes(
          process.env.OFFICIAL_COMPANY_SCHEDULE_MINUTES,
          360
        ),
      }))
    ),
  ];
}

export function getScheduledConnectorSnapshot() {
  return getScheduledConnectors().map((definition) => ({
    connectorKey: definition.connector.key,
    sourceName: definition.connector.sourceName,
    cadenceMinutes: definition.cadenceMinutes,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveOptionalSuccessFactorsScheduledConnectors(promotedTokens: string[]) {
  if (!isSourceFamilyEnabled("successfactors")) return [];
  const tokens = resolveTokens(
    mergeTokenValues(process.env.SUCCESSFACTORS_DOMAIN_TOKENS ?? "", promotedTokens)
  );
  if (tokens.length === 0) return [];

  return tokens.map((sourceToken) => ({
    connector: createSuccessFactorsConnector({ sourceToken }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.SUCCESSFACTORS_SCHEDULE_MINUTES,
      240
    ),
  }));
}

function resolveOptionalSmartRecruitersScheduledConnectors(
  promotedTokens: string[]
) {
  if (!isSourceFamilyEnabled("smartrecruiters")) return [];
  const defaults = SMARTRECRUITERS_DEFAULT_COMPANY_TOKENS.join(",");
  const tokens = resolveTokens(
    mergeTokenValues(process.env.SMARTRECRUITERS_COMPANY_TOKENS ?? defaults, promotedTokens)
  );
  if (tokens.length === 0) return [];

  return tokens.map((companyIdentifier) => ({
    connector: createSmartRecruitersConnector({ companyIdentifier }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.SMARTRECRUITERS_SCHEDULE_MINUTES,
      240
    ),
  }));
}

function resolveOptionalWorkableScheduledConnectors(promotedTokens: string[]) {
  if (!isSourceFamilyEnabled("workable")) return [];
  const defaults = WORKABLE_DEFAULT_ACCOUNT_TOKENS.join(",");
  const tokens = resolveTokens(
    mergeTokenValues(process.env.WORKABLE_ACCOUNT_TOKENS ?? defaults, promotedTokens)
  );
  if (tokens.length === 0) return [];

  return tokens.map((accountToken) => ({
    connector: createWorkableConnector({ accountToken }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.WORKABLE_SCHEDULE_MINUTES,
      240
    ),
  }));
}

function resolveOptionalJobviteScheduledConnectors(promotedTokens: string[]) {
  if (!isSourceFamilyEnabled("jobvite")) return [];
  const tokens = resolveTokens(
    mergeTokenValues(
      process.env.JOBVITE_COMPANY_TOKENS ?? DEFAULT_JOBVITE_COMPANIES,
      promotedTokens
    )
  );
  if (tokens.length === 0) return [];

  return tokens.map((companyToken) => ({
    connector: createJobviteConnector({ companyToken }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.JOBVITE_SCHEDULE_MINUTES,
      240
    ),
  }));
}

function resolveOptionalTeamtailorScheduledConnectors(promotedTokens: string[]) {
  if (!isSourceFamilyEnabled("teamtailor")) return [];
  const tokens = resolveTokens(
    mergeTokenValues(
      process.env.TEAMTAILOR_COMPANY_TOKENS ?? DEFAULT_TEAMTAILOR_COMPANIES,
      promotedTokens
    )
  );
  if (tokens.length === 0) return [];

  return tokens.map((companyToken) => ({
    connector: createTeamtailorConnector({ companyToken }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.TEAMTAILOR_SCHEDULE_MINUTES,
      240
    ),
  }));
}

function resolveOptionalIcimsScheduledConnectors(promotedTokens: string[]) {
  if (!isSourceFamilyEnabled("icims")) return [];
  const defaults = ICIMS_DEFAULT_PORTAL_TOKENS.join(",");
  const tokens = resolveTokens(
    mergeTokenValues(process.env.ICIMS_PORTAL_TOKENS ?? defaults, promotedTokens)
  );
  if (tokens.length === 0) return [];

  return tokens.map((portalSubdomain) => ({
    connector: createIcimsConnector({ portalSubdomain }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.ICIMS_SCHEDULE_MINUTES,
      240
    ),
  }));
}

function resolveOptionalHimalayasScheduledConnectors() {
  if (!isSourceFamilyEnabled("himalayas")) return [];
  const profiles = resolveTokens(process.env.HIMALAYAS_SOURCES ?? "global");
  return profiles.map((profile) => ({
    connector: createHimalayasConnector({ profile }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.HIMALAYAS_SCHEDULE_MINUTES,
      720
    ),
  }));
}

function resolveOptionalJobicyScheduledConnectors() {
  if (!isSourceFamilyEnabled("jobicy")) return [];
  return [
    {
      connector: createJobicyConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.JOBICY_SCHEDULE_MINUTES,
        720
      ),
    },
  ];
}

// Default Jooble shard set when JOOBLE_SCHEDULE_PROFILES is not configured.
//
// History: the previous default was just "feed", which meant a brand-new
// deployment ran ONE Jooble shard with a generic keyword list. That was
// fine when the product was tech & finance only, but the live pool now
// targets all white-collar (TECH + FINANCE + GENERAL). Defaulting to the
// per-family shards means a fresh deployment ramps up coverage across
// marketing/sales/hr/legal/ops/etc. immediately.
//
// Heavy production deployments can still override the entire list via
// JOOBLE_SCHEDULE_PROFILES. Cadence is shared (360 min default) — the
// adaptive runtime budget handles per-shard sizing.
const DEFAULT_JOOBLE_SHARDS = [
  // Broad baselines
  "feed",
  "all-na",
  // Tech (still our largest single category)
  "tech-na",
  "tech-cities-us",
  "tech-cities-ca",
  // Finance
  "finance-na",
  "finance-cities-us",
  // Early career / interns
  "early-career-na",
  // GENERAL — per-family shards (10 families × {NA, cities-US, cities-CA})
  "marketing-na",
  "marketing-cities-us",
  "marketing-cities-ca",
  "sales-na",
  "sales-cities-us",
  "sales-cities-ca",
  "hr-na",
  "hr-cities-us",
  "hr-cities-ca",
  "legal-na",
  "legal-cities-us",
  "ops-admin-na",
  "ops-admin-cities-us",
  "ops-admin-cities-ca",
  "supply-chain-na",
  "supply-chain-cities-us",
  "consulting-na",
  "consulting-cities-us",
  "communications-na",
  "communications-cities-us",
  "customer-success-na",
  "customer-success-cities-us",
  "biz-dev-na",
  "biz-dev-cities-us",
  // Newly added GENERAL families — public sector, edu admin, healthcare
  // admin, nonprofit, real estate, insurance, hospitality mgmt, editorial,
  // research/policy, construction PM, content creators.
  "government-na",
  "government-cities-us",
  "education-admin-na",
  "education-admin-cities-us",
  "healthcare-admin-na",
  "healthcare-admin-cities-us",
  "nonprofit-na",
  "nonprofit-cities-us",
  "real-estate-na",
  "real-estate-cities-us",
  "insurance-na",
  "insurance-cities-us",
  "hospitality-mgmt-na",
  "hospitality-mgmt-cities-us",
  "editorial-na",
  "editorial-cities-us",
  "research-policy-na",
  "research-policy-cities-us",
  "construction-pm-na",
  "content-creator-na",
  "content-creator-cities-us",
  // ── Deep / specialty shards for the 12 priority categories ────────────
  // Added as part of the aggressive-expansion push. Each focuses on
  // specialty keyword variants the broad shards miss.
  "engineering-na",
  "engineering-cities-us",
  "engineering-cities-ca",
  "law-deep-na",
  "law-deep-cities-us",
  "accounting-deep-na",
  "accounting-deep-cities-us",
  "hr-deep-na",
  "hr-deep-cities-us",
  "marketing-deep-na",
  "marketing-deep-cities-us",
  "sales-deep-na",
  "sales-deep-cities-us",
  "healthcare-admin-deep-na",
  "healthcare-admin-deep-cities-us",
  "consulting-deep-na",
  "consulting-deep-cities-us",
  "bizops-deep-na",
  "bizops-deep-cities-us",
  // Rotation profiles — pair fresh keywords with mid-tier / under-mined
  // cities so exhausted shards' search space gets new coverage.
  "admin-rotation-na",
  "early-career-rotation-na",
  "security-rotation-na",
  "fintech-rotation-na",
  "tech-rotation-na",
  "finance-rotation-na",
];

function resolveOptionalJoobleScheduledConnectors() {
  if (readBooleanEnv("INGEST_ALLOW_JOOBLE") !== true) return [];
  if (!isSourceFamilyEnabled("jooble", false)) return [];
  if (!(process.env.JOOBLE_API_KEY ?? "").trim()) return [];

  const profilesEnv = process.env.JOOBLE_SCHEDULE_PROFILES?.trim();
  // When the env var is set, honor it verbatim (the production droplets
  // already have a curated list). When it's missing, default to the broad
  // per-family shard set so all-roles coverage starts immediately.
  const profiles = profilesEnv
    ? resolveTokens(profilesEnv)
    : DEFAULT_JOOBLE_SHARDS;
  const cadenceMinutes = resolveCadenceMinutes(
    process.env.JOOBLE_SCHEDULE_MINUTES,
    360
  );

  return profiles.map((profile) => ({
    connector: createJoobleConnector({ profile }),
    cadenceMinutes,
  }));
}

function resolveOptionalRemotiveScheduledConnectors() {
  if (!isSourceFamilyEnabled("remotive")) return [];
  return [
    {
      connector: createRemotiveConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.REMOTIVE_SCHEDULE_MINUTES,
        720
      ),
    },
  ];
}

function resolveOptionalMuseScheduledConnectors() {
  if (!isSourceFamilyEnabled("themuse")) return [];
  return [
    {
      connector: createMuseConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.THEMUSE_SCHEDULE_MINUTES,
        720
      ),
    },
  ];
}

function resolveOptionalAdzunaScheduledConnectors() {
  if (!isSourceFamilyEnabled("adzuna")) return [];
  const appId = process.env.ADZUNA_APP_ID ?? "";
  const appKey = process.env.ADZUNA_APP_KEY ?? "";
  if (!appId || !appKey) return [];

  // Default to NA-only. The product is North America first — pulling all 16
  // Adzuna countries stores tens of thousands of out-of-scope jobs that never
  // appear in the feed and bloat the DB. Override via ADZUNA_COUNTRIES env var.
  const countries = resolveTokens(
    process.env.ADZUNA_COUNTRIES ?? "us,ca"
  );
  const cadence = resolveCadenceMinutes(process.env.ADZUNA_SCHEDULE_MINUTES, 360);
  const additionalProfiles = readCsvEnv(
    "ADZUNA_SCHEDULE_PROFILES",
    // Default profile set: techcore + specialist + discovery (tech/finance
    // focused) PLUS the new general-people + general-commercial profiles
    // that cover HR/legal/admin/CS and marketing/sales/design respectively.
    [
      "techcore",
      "specialist",
      "discovery",
      "general-people",
      "general-commercial",
    ]
  ).filter((profile) => profile !== "ALL");

  // Primary broad connectors per country
  const primary = countries.map((country) => ({
    connector: createAdzunaConnector({ country, appId, appKey }),
    cadenceMinutes: cadence,
  }));

  // Additional profile connectors for deeper per-category coverage
  const additional = countries.flatMap((country) =>
    additionalProfiles.map((profile) => ({
      connector: createAdzunaConnector({ country, appId, appKey, profile }),
      cadenceMinutes: cadence,
    }))
  );

  return [...primary, ...additional];
}

function resolveOptionalRemoteOkScheduledConnectors() {
  if (!isSourceFamilyEnabled("remoteok")) return [];
  return [
    {
      connector: createRemoteOkConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.REMOTEOK_SCHEDULE_MINUTES,
        720
      ),
    },
  ];
}

function resolveOptionalWeWorkRemotelyScheduledConnectors() {
  if (!isSourceFamilyEnabled("weworkremotely")) return [];
  // WWR listings turn over quickly (30-day expiry, fresh posts every few hours).
  // 6h cadence is aggressive enough to keep freshness high without hammering
  // their Cloudflare-fronted RSS endpoints.
  return [
    {
      connector: createWeWorkRemotelyConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.WEWORKREMOTELY_SCHEDULE_MINUTES,
        360
      ),
    },
  ];
}

function resolveOptionalUsaJobsScheduledConnectors() {
  if (!isSourceFamilyEnabled("usajobs")) return [];
  const apiKey = process.env.USAJOBS_API_KEY ?? "";
  const email = process.env.USAJOBS_EMAIL ?? "";
  if (!apiKey || !email) return [];

  const cadenceMinutes = resolveCadenceMinutes(
    process.env.USAJOBS_SCHEDULE_MINUTES,
    720
  );

  // If USAJOBS_KEYWORDS is set, honor that exact list. Otherwise use the
  // batch helper which spins up one connector per default keyword across
  // all 12 priority categories. Each becomes its own ingestion shard.
  const envKeywords = process.env.USAJOBS_KEYWORDS?.trim();
  if (envKeywords) {
    const tokens = resolveTokens(envKeywords);
    return tokens.map((keyword) => ({
      connector: createUsaJobsConnector({ keyword, apiKey, email }),
      cadenceMinutes,
    }));
  }

  return createUsaJobsBatchConnectors({ apiKey, email }).map((connector) => ({
    connector,
    cadenceMinutes,
  }));
}

// Default Oracle Cloud HCM tenants seeded from production hiringcafe data.
// Format: "<tenant_host>|<site>" — site defaults to "CX" when omitted.
// Override via ORACLECLOUD_TENANTS env var (comma-separated). When the env
// var is set production deployments should provide validated tenants
// because Oracle's REST endpoint blocks unknown tenants with 404.
const DEFAULT_ORACLE_CLOUD_TENANTS: string[] = [
  "ejov.fa.ca2.oraclecloud.com|CX",
  "emgi.fa.ca3.oraclecloud.com|CX",
  "hcrw.fa.us2.oraclecloud.com|CX",
  "hcpd.fa.ca2.oraclecloud.com|CX",
  "iaemup.fa.ocs.oraclecloud.com|CX",
  "fa-exhh-saasfaprod1.fa.ocs.oraclecloud.com|CX",
  "fa-evcg-saasfaprod1.fa.ocs.oraclecloud.com|CX",
  "fa-evlf-saasfaprod1.fa.ocs.oraclecloud.com|CX",
];

function resolveOptionalWorkAtAStartupScheduledConnectors() {
  if (!isSourceFamilyEnabled("workatastartup")) return [];
  return [
    {
      connector: createWorkAtAStartupConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.WORKATASTARTUP_SCHEDULE_MINUTES,
        720
      ),
    },
  ];
}

// Default BreezyHR tenants. The format is just the subdomain — each
// company on BreezyHR exposes /json from {company}.breezy.hr. Override
// via BREEZYHR_COMPANIES env var (comma-separated). The discovery pipeline
// will eventually surface more tenants via hiringcafe's upstreamSource
// field — these are starter seeds.
const DEFAULT_BREEZYHR_COMPANIES: string[] = [
  // Seeded from hiringcafe upstream-source surface area + mid-market employers
  // known to use BreezyHR. Discovery pipeline will add more over time.
  "toloka-annotators",
];

function resolveOptionalBreezyHrScheduledConnectors() {
  if (!isSourceFamilyEnabled("breezyhr")) return [];
  const envCompanies = process.env.BREEZYHR_COMPANIES?.trim();
  const tokens = envCompanies
    ? resolveTokens(envCompanies)
    : DEFAULT_BREEZYHR_COMPANIES;
  if (tokens.length === 0) return [];

  const cadenceMinutes = resolveCadenceMinutes(
    process.env.BREEZYHR_SCHEDULE_MINUTES,
    720
  );

  return tokens
    .map((company) => {
      try {
        return {
          connector: createBreezyHrConnector({ company }),
          cadenceMinutes,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is { connector: ReturnType<typeof createBreezyHrConnector>; cadenceMinutes: number } => entry !== null
    );
}

// Default Hireology customer slugs. Override via HIREOLOGY_SLUGS env var.
// Currently empty by default — Hireology covers mid-market employers
// (auto dealer HQ functions, retail, hospitality) and tenants need to
// be discovered case-by-case. The discovery pipeline will eventually
// add more.
const DEFAULT_HIREOLOGY_SLUGS: string[] = [];

function resolveOptionalHireologyScheduledConnectors() {
  if (!isSourceFamilyEnabled("hireology")) return [];
  const envSlugs = process.env.HIREOLOGY_SLUGS?.trim();
  const tokens = envSlugs ? resolveTokens(envSlugs) : DEFAULT_HIREOLOGY_SLUGS;
  if (tokens.length === 0) return [];

  const cadenceMinutes = resolveCadenceMinutes(
    process.env.HIREOLOGY_SCHEDULE_MINUTES,
    720
  );

  return tokens
    .map((slug) => {
      try {
        return {
          connector: createHireologyConnector({ slug }),
          cadenceMinutes,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is { connector: ReturnType<typeof createHireologyConnector>; cadenceMinutes: number } => entry !== null
    );
}

// Paradox / HRSmart tenants are configured as "tenant|boardUrl" pairs in
// the env. Neither has a uniform URL pattern across customers, so we
// require explicit board URLs. Format:
//   PARADOX_TENANTS="acme|https://careers.acme.com,foo|https://foo.paradox.ai/jobs"
function resolveJsonLdBoardTokenList(envName: string): Array<{
  tenant: string;
  boardUrl: string;
}> {
  const raw = process.env[envName]?.trim();
  if (!raw) return [];
  return resolveTokens(raw)
    .map((token) => {
      const [tenant, boardUrl] = token.split("|");
      if (!tenant || !boardUrl) return null;
      return { tenant: tenant.trim(), boardUrl: boardUrl.trim() };
    })
    .filter((entry): entry is { tenant: string; boardUrl: string } =>
      entry !== null && entry.tenant.length > 0 && /^https?:\/\//.test(entry.boardUrl)
    );
}

function resolveOptionalParadoxScheduledConnectors() {
  if (!isSourceFamilyEnabled("paradox")) return [];
  const tokens = resolveJsonLdBoardTokenList("PARADOX_TENANTS");
  if (tokens.length === 0) return [];
  const cadenceMinutes = resolveCadenceMinutes(
    process.env.PARADOX_SCHEDULE_MINUTES,
    720
  );
  return tokens
    .map(({ tenant, boardUrl }) => {
      try {
        return {
          connector: createParadoxConnector({ tenant, boardUrl }),
          cadenceMinutes,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is { connector: ReturnType<typeof createParadoxConnector>; cadenceMinutes: number } => entry !== null
    );
}

function resolveOptionalHrSmartScheduledConnectors() {
  if (!isSourceFamilyEnabled("hrsmart")) return [];
  const tokens = resolveJsonLdBoardTokenList("HRSMART_TENANTS");
  if (tokens.length === 0) return [];
  const cadenceMinutes = resolveCadenceMinutes(
    process.env.HRSMART_SCHEDULE_MINUTES,
    720
  );
  return tokens
    .map(({ tenant, boardUrl }) => {
      try {
        return {
          connector: createHrSmartConnector({ tenant, boardUrl }),
          cadenceMinutes,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is { connector: ReturnType<typeof createHrSmartConnector>; cadenceMinutes: number } => entry !== null
    );
}

function resolveOptionalJSearchScheduledConnectors() {
  if (!isSourceFamilyEnabled("jsearch")) return [];
  if (!(process.env.JSEARCH_API_KEY ?? "").trim()) return [];
  // Free tier = 200 reqs/month. Default cadence is once per day (1440 min)
  // with JSEARCH_MAX_REQUESTS_PER_RUN=1 → ~30 reqs/month. Plenty of
  // headroom under the cap. Either cadence or per-run can be tuned via env.
  return [
    {
      connector: createJSearchConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.JSEARCH_SCHEDULE_MINUTES,
        1440
      ),
    },
  ];
}

function resolveOptionalOracleCloudScheduledConnectors() {
  if (!isSourceFamilyEnabled("oraclecloud")) return [];

  const envTenants = process.env.ORACLECLOUD_TENANTS?.trim();
  const tokens = envTenants ? resolveTokens(envTenants) : DEFAULT_ORACLE_CLOUD_TENANTS;
  if (tokens.length === 0) return [];

  const cadenceMinutes = resolveCadenceMinutes(
    process.env.ORACLECLOUD_SCHEDULE_MINUTES,
    720
  );

  return tokens
    .map((token) => {
      const [tenant, site] = token.split("|");
      if (!tenant || !/\.oraclecloud\.com$/i.test(tenant)) return null;
      try {
        return {
          connector: createOracleCloudConnector({
            tenant,
            site: site?.trim() || "CX",
          }),
          cadenceMinutes,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is { connector: ReturnType<typeof createOracleCloudConnector>; cadenceMinutes: number } => entry !== null
    );
}

function resolveOptionalJobBankScheduledConnectors() {
  if (!isSourceFamilyEnabled("jobbank")) return [];
  // Job Bank CSV is updated monthly — run once per day (1440 min)
  return [
    {
      connector: createJobBankConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.JOBBANK_SCHEDULE_MINUTES,
        1440
      ),
    },
  ];
}

// Live JobBank search — much fresher than the monthly CSV. Rotates through
// 30 keyword × city combos using IngestionRun checkpoint; 6 queries per run
// at default settings. Cadence: every 60 min (the search-results page is
// updated continuously by employers throughout the day).
function resolveOptionalJobBankLiveScheduledConnectors() {
  if (!isSourceFamilyEnabled("jobbank-live")) return [];
  return [
    {
      connector: createJobBankLiveConnector(),
      cadenceMinutes: resolveCadenceMinutes(
        process.env.JOBBANK_LIVE_SCHEDULE_MINUTES,
        60
      ),
    },
  ];
}

function resolveOptionalTaleoScheduledConnectors(promotedTokens: string[]) {
  if (!isSourceFamilyEnabled("taleo")) return [];
  const tokens = resolveTokens(
    mergeTokenValues(process.env.TALEO_SOURCE_TOKENS ?? DEFAULT_TALEO_SOURCES, promotedTokens)
  );
  if (tokens.length === 0) return [];

  return tokens.map((sourceToken) => ({
    connector: createTaleoConnector({ sourceToken }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.TALEO_SCHEDULE_MINUTES,
      360
    ),
  }));
}

function resolveOptionalWorkdayScheduledConnectors(promotedTokens: string[]) {
  if (!isSourceFamilyEnabled("workday")) return [];
  const tokens = resolveTokens(
    mergeTokenValues(process.env.WORKDAY_SOURCE_TOKENS ?? "", promotedTokens)
  );
  if (tokens.length === 0) return [];

  return tokens.map((sourceToken) => ({
    connector: createWorkdayConnector({ sourceToken }),
    cadenceMinutes: resolveCadenceMinutes(
      process.env.WORKDAY_SCHEDULE_MINUTES,
      240
    ),
  }));
}

function resolveCadenceMinutes(
  rawValue: string | undefined,
  fallback: number
) {
  if (!rawValue) return fallback;
  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) return fallback;
  return parsedValue;
}

function resolveTokens(rawValue: string) {
  return rawValue
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function mergeTokenValues(baseValue: string, promotedTokens: string[]) {
  const mergedTokens = [...new Set([...resolveTokens(baseValue), ...promotedTokens])];
  return mergedTokens.join(",");
}

function resolveScheduledFamily<T>(
  sourceFamily: SupportedConnectorName,
  factory: () => T[]
) {
  if (!isSourceFamilyEnabled(sourceFamily)) {
    return [];
  }

  return factory();
}

function loadPromotedDiscoveryTargets() {
  const emptyTargets: Record<SupportedConnectorName, string[]> = {
    adzuna: [],
    ashby: [],
    greenhouse: [],
    himalayas: [],
    icims: [],
    jobicy: [],
    jooble: [],
    jobvite: [],
    teamtailor: [],
    breezyhr: [],
    hireology: [],
    hrsmart: [],
    jsearch: [],
    lever: [],
    paradox: [],
    oraclecloud: [],
    remotive: [],
    workatastartup: [],
    themuse: [],
    recruitee: [],
    remoteok: [],
    rippling: [],
    successfactors: [],
    smartrecruiters: [],
    taleo: [],
    usajobs: [],
    workday: [],
    workable: [],
    jobbank: [],
    "jobbank-live": [],
    "official-company": [],
    weworkremotely: [],
  };

  if (!existsSync(DISCOVERY_STORE_PATH)) {
    return emptyTargets;
  }

  try {
    const store = JSON.parse(
      readFileSync(DISCOVERY_STORE_PATH, "utf8")
    ) as DiscoveryStore;

    for (const entry of store.entries ?? []) {
      if (
        !entry ||
        entry.status !== "promoted" ||
        !entry.connectorName ||
        !entry.token
      ) {
        continue;
      }

      emptyTargets[entry.connectorName].push(entry.token);
    }
  } catch {
    return emptyTargets;
  }

  for (const connectorName of Object.keys(emptyTargets) as SupportedConnectorName[]) {
    emptyTargets[connectorName] = [...new Set(emptyTargets[connectorName])];
  }

  return emptyTargets;
}
