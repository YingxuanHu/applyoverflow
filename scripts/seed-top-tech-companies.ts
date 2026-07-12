/**
 * Seed CompanySource entries for top-tier tech companies the user wants us
 * to ingest from directly. Each entry maps a company to a known ATS family
 * + token; we already have connectors for those ATSes, so creating the
 * CompanySource rows is enough — the validation/poll workers will pick them
 * up on the next cycle.
 *
 * Companies on truly custom platforms (Google, Microsoft careers API, Meta,
 * Amazon Jobs, Apple, Uber, Netflix, Stripe, Atlassian) need a brand-new
 * connector each — those are intentionally NOT in this list. Add them as we
 * build the per-vendor scrapers.
 *
 * Idempotent: re-runs are safe — we upsert Company and skip CompanySource if
 * a (connectorName, token) row already exists on that company.
 *
 * Usage:
 *   tsx -r dotenv/config scripts/seed-top-tech-companies.ts
 */
import "dotenv/config";

import process from "node:process";
import { prisma } from "@/lib/db";

type Entry = {
  companyName: string;
  /** lowercased slug used to dedupe companies */
  companyKey?: string;
  connector:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workday"
    | "successfactors"
    | "smartrecruiters"
    | "icims"
    | "workable";
  /** Token format depends on connector — see boardUrl for the canonical URL */
  token: string;
  boardUrl: string;
};

function key(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// High-confidence mappings. Each company → (ATS, token, board URL).
// Verified or commonly-known company tokens. If a token is wrong, the
// validation worker will mark the source INVALID; nothing else breaks.
const ENTRIES: Entry[] = [
  // ── AI / ML ──────────────────────────────────────────────────────────────
  { companyName: "OpenAI", connector: "ashby", token: "openai", boardUrl: "https://jobs.ashbyhq.com/openai" },
  { companyName: "Anthropic", connector: "ashby", token: "anthropic", boardUrl: "https://jobs.ashbyhq.com/anthropic" },
  { companyName: "Cohere", connector: "ashby", token: "cohere", boardUrl: "https://jobs.ashbyhq.com/cohere" },
  { companyName: "Hugging Face", companyKey: "hugging-face", connector: "greenhouse", token: "huggingface", boardUrl: "https://boards.greenhouse.io/huggingface" },
  { companyName: "Scale AI", companyKey: "scale-ai", connector: "greenhouse", token: "scaleai", boardUrl: "https://boards.greenhouse.io/scaleai" },
  { companyName: "Palantir", connector: "lever", token: "palantir", boardUrl: "https://jobs.lever.co/palantir" },

  // ── Big chips / hardware on Workday ──────────────────────────────────────
  { companyName: "NVIDIA", connector: "workday", token: "nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite", boardUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" },
  { companyName: "AMD", connector: "workday", token: "amd.wd1.myworkdayjobs.com|amd|External", boardUrl: "https://amd.wd1.myworkdayjobs.com/External" },
  { companyName: "Qualcomm", connector: "workday", token: "qualcomm.wd12.myworkdayjobs.com|qualcomm|external", boardUrl: "https://qualcomm.wd12.myworkdayjobs.com/external" },

  // ── Enterprise SaaS / cloud on Workday ───────────────────────────────────
  { companyName: "IBM", connector: "workday", token: "ibm.wd1.myworkdayjobs.com|ibm|IBM", boardUrl: "https://ibm.wd1.myworkdayjobs.com/IBM" },
  { companyName: "Adobe", connector: "workday", token: "adobe.wd5.myworkdayjobs.com|adobe|external_experienced", boardUrl: "https://adobe.wd5.myworkdayjobs.com/external_experienced" },
  { companyName: "Salesforce", connector: "workday", token: "salesforce.wd12.myworkdayjobs.com|salesforce|External_Career_Site", boardUrl: "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site" },
  { companyName: "Twilio", connector: "workday", token: "twilio.wd5.myworkdayjobs.com|twilio|twilio", boardUrl: "https://twilio.wd5.myworkdayjobs.com/twilio" },
  { companyName: "Okta", connector: "workday", token: "okta.wd5.myworkdayjobs.com|okta|OktaCareers", boardUrl: "https://okta.wd5.myworkdayjobs.com/OktaCareers" },
  { companyName: "ServiceNow", connector: "workday", token: "servicenow.wd1.myworkdayjobs.com|servicenow|ServiceNowCareers", boardUrl: "https://servicenow.wd1.myworkdayjobs.com/ServiceNowCareers" },
  { companyName: "Workday", connector: "workday", token: "workday.wd5.myworkdayjobs.com|workday|Workday", boardUrl: "https://workday.wd5.myworkdayjobs.com/Workday" },
  { companyName: "Cisco", connector: "workday", token: "cisco.wd5.myworkdayjobs.com|cisco|at_cisco", boardUrl: "https://cisco.wd5.myworkdayjobs.com/at_cisco" },
  { companyName: "Intuit", connector: "workday", token: "intuit.wd5.myworkdayjobs.com|intuit|IntuitCareers", boardUrl: "https://intuit.wd5.myworkdayjobs.com/IntuitCareers" },
  { companyName: "Ericsson", connector: "workday", token: "ericsson.wd3.myworkdayjobs.com|ericsson|Ericsson_Careers", boardUrl: "https://ericsson.wd3.myworkdayjobs.com/Ericsson_Careers" },
  { companyName: "Nokia", connector: "workday", token: "nokia.wd3.myworkdayjobs.com|nokia|nokia", boardUrl: "https://nokia.wd3.myworkdayjobs.com/nokia" },
  { companyName: "Electronic Arts", companyKey: "electronic-arts", connector: "workday", token: "ea.wd1.myworkdayjobs.com|ea|EA", boardUrl: "https://ea.wd1.myworkdayjobs.com/EA" },

  // ── SAP / SuccessFactors ─────────────────────────────────────────────────
  { companyName: "SAP", connector: "successfactors", token: "jobs.sap.com", boardUrl: "https://jobs.sap.com/" },

  // ── Greenhouse-hosted (most modern startups + scaleups) ──────────────────
  { companyName: "Datadog", connector: "greenhouse", token: "datadog", boardUrl: "https://boards.greenhouse.io/datadog" },
  { companyName: "Databricks", connector: "greenhouse", token: "databricks", boardUrl: "https://boards.greenhouse.io/databricks" },
  { companyName: "MongoDB", connector: "greenhouse", token: "mongodb", boardUrl: "https://boards.greenhouse.io/mongodb" },
  { companyName: "Snowflake", connector: "greenhouse", token: "snowflake", boardUrl: "https://boards.greenhouse.io/snowflake" },
  { companyName: "GitLab", connector: "greenhouse", token: "gitlab", boardUrl: "https://boards.greenhouse.io/gitlab" },
  { companyName: "Cloudflare", connector: "greenhouse", token: "cloudflare", boardUrl: "https://boards.greenhouse.io/cloudflare" },
  { companyName: "Block", connector: "greenhouse", token: "block", boardUrl: "https://boards.greenhouse.io/block" },
  { companyName: "Square", connector: "greenhouse", token: "square", boardUrl: "https://boards.greenhouse.io/square" },
  { companyName: "Robinhood", connector: "greenhouse", token: "robinhood", boardUrl: "https://boards.greenhouse.io/robinhood" },
  { companyName: "Coinbase", connector: "greenhouse", token: "coinbase", boardUrl: "https://boards.greenhouse.io/coinbase" },
  { companyName: "Wealthsimple", connector: "greenhouse", token: "wealthsimple", boardUrl: "https://boards.greenhouse.io/wealthsimple" },
  { companyName: "Faire", connector: "greenhouse", token: "faire", boardUrl: "https://boards.greenhouse.io/faire" },
  { companyName: "Instacart", connector: "greenhouse", token: "instacart", boardUrl: "https://boards.greenhouse.io/instacart" },
  { companyName: "DoorDash", connector: "greenhouse", token: "doordash", boardUrl: "https://boards.greenhouse.io/doordash" },
  { companyName: "Airbnb", connector: "greenhouse", token: "airbnb", boardUrl: "https://boards.greenhouse.io/airbnb" },
  { companyName: "Discord", connector: "greenhouse", token: "discord", boardUrl: "https://boards.greenhouse.io/discord" },
  { companyName: "Figma", connector: "greenhouse", token: "figma", boardUrl: "https://boards.greenhouse.io/figma" },
  { companyName: "Asana", connector: "greenhouse", token: "asana", boardUrl: "https://boards.greenhouse.io/asana" },
  { companyName: "Notion", connector: "greenhouse", token: "notion", boardUrl: "https://boards.greenhouse.io/notion" },
  { companyName: "Dropbox", connector: "greenhouse", token: "dropbox", boardUrl: "https://boards.greenhouse.io/dropbox" },
  { companyName: "Roblox", connector: "greenhouse", token: "roblox", boardUrl: "https://boards.greenhouse.io/roblox" },
  { companyName: "Riot Games", connector: "greenhouse", token: "riotgames", boardUrl: "https://boards.greenhouse.io/riotgames" },
  { companyName: "GitHub", connector: "greenhouse", token: "github", boardUrl: "https://boards.greenhouse.io/github" },
  { companyName: "Shopify", connector: "greenhouse", token: "shopify", boardUrl: "https://boards.greenhouse.io/shopify" },
];

async function run() {
  let companiesCreated = 0;
  let companiesReused = 0;
  let sourcesCreated = 0;
  let sourcesSkipped = 0;

  for (const entry of ENTRIES) {
    const companyKey = entry.companyKey ?? key(entry.companyName);
    const sourceName = `${entry.connector[0]!.toUpperCase()}${entry.connector.slice(1)}:${entry.token}`;

    // Find or create the Company row first — CompanySource requires a
    // valid companyId FK. Use companyKey for stable identity.
    let company = await prisma.company.findFirst({
      where: { companyKey },
      select: { id: true },
    });

    if (!company) {
      company = await prisma.company.create({
        data: {
          name: entry.companyName,
          companyKey,
          discoveryStatus: "DISCOVERED",
          crawlStatus: "IDLE",
          discoveryConfidence: 1.0,
          metadataJson: { seedSource: "top-tech-curated:v1" },
        },
        select: { id: true },
      });
      companiesCreated += 1;
    } else {
      companiesReused += 1;
    }

    // Skip if we already have this source either keyed on companyId + (connector,token)
    // OR keyed on sourceName globally (sourceName has a UNIQUE constraint, so a
    // duplicate elsewhere would block the INSERT anyway).
    const existingSource = await prisma.companySource.findFirst({
      where: {
        OR: [
          { sourceName },
          {
            companyId: company.id,
            connectorName: entry.connector,
            token: entry.token,
          },
        ],
      },
      select: { id: true, companyId: true },
    });

    if (existingSource) {
      if (existingSource.companyId !== company.id) {
        await prisma.companySource.update({
          where: { id: existingSource.id },
          data: {
            companyId: company.id,
            metadataJson: {
              seedSource: "top-tech-curated:v1",
              curatedAt: new Date().toISOString(),
              repairedCompanyOwnerAt: new Date().toISOString(),
              previousCompanySourceOwnerId: existingSource.companyId,
            },
          },
        });
      }
      sourcesSkipped += 1;
      continue;
    }

    await prisma.companySource.create({
      data: {
        companyId: company.id,
        sourceName,
        connectorName: entry.connector,
        token: entry.token,
        boardUrl: entry.boardUrl,
        status: "ACTIVE",
        sourceType: "ATS",
        extractionRoute: "ATS_NATIVE",
        parserVersion: "top-tech-curated:v1",
        pollingCadenceMinutes: 60,
        priorityScore: 1.5, // boosted vs. discovery default (0.8) — high-value boards
        pollState: "READY",
        validationState: "UNVALIDATED",
        metadataJson: {
          seedSource: "top-tech-curated:v1",
          curatedAt: new Date().toISOString(),
        },
      },
    });
    sourcesCreated += 1;
  }

  console.log(
    `[seed-top-tech] companies created=${companiesCreated} reused=${companiesReused} | sources created=${sourcesCreated} skipped=${sourcesSkipped} (total entries=${ENTRIES.length})`
  );
}

run()
  .catch((error) => {
    console.error("[seed-top-tech] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
