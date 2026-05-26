/**
 * add-workday-tokens.ts
 *
 * Reads 51 known Workday tokens from /tmp/workday-discovered-tokens.jsonl
 * and inserts/updates them as CompanySource records with status ACTIVE /
 * validationState VALIDATED / pollState READY.
 *
 * Usage:
 *   node --max-old-space-size=512 node_modules/.bin/tsx -r dotenv/config scripts/add-workday-tokens.ts
 */

import { readFileSync } from "node:fs";
import { ensureCompanyRecord } from "../src/lib/ingestion/company-records";
import { upsertCompanySourceByIdentity } from "../src/lib/ingestion/company-source-upsert";
import { buildCompanyKey } from "../src/lib/ingestion/discovery/company-corpus";
import { prisma } from "../src/lib/db";

const INPUT_FILE = "/tmp/workday-discovered-tokens.jsonl";
const DEFAULT_POLL_CADENCE_MINUTES = 180;

interface WorkdayTokenEntry {
  host: string;
  tenant: string;
  site: string;
  token?: string;
}

function deriveCompanyName(tenant: string): string {
  return tenant
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function readJsonlEntries(filePath: string): WorkdayTokenEntry[] {
  const raw = readFileSync(filePath, "utf8");
  const entries: WorkdayTokenEntry[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as WorkdayTokenEntry);
    } catch {
      console.warn(`[add-workday-tokens] Skipping unparseable line: ${trimmed}`);
    }
  }

  return entries;
}

async function main() {
  console.log(`[add-workday-tokens] Reading entries from ${INPUT_FILE}`);
  const entries = readJsonlEntries(INPUT_FILE);
  console.log(`[add-workday-tokens] Found ${entries.length} entries`);

  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const now = new Date();

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { host, tenant, site } = entry;

    // The token is the composite host|tenant|site string
    const token = `${host}|${tenant}|${site}`;
    const boardUrl = `https://${host}/${tenant}/${site}/jobs`;
    const companyName = deriveCompanyName(tenant);
    const companyKey = buildCompanyKey(companyName);
    const sourceName = `Workday:${token}`;

    console.log(
      `[add-workday-tokens] [${i + 1}/${entries.length}] Processing ${companyName} (token: ${token})`
    );

    try {
      const company = await ensureCompanyRecord({
        companyName,
        companyKey,
        careersUrl: boardUrl,
        detectedAts: "workday",
        discoveryStatus: "DISCOVERED",
        discoveryConfidence: 0.9,
      });

      const existingBefore = await prisma.companySource.findFirst({
        where: {
          companyId: company.id,
          connectorName: "workday",
          token,
        },
        select: { id: true },
      });

      await upsertCompanySourceByIdentity({
        identity: {
          companyId: company.id,
          connectorName: "workday",
          token,
          sourceName,
        },
        create: {
          companyId: company.id,
          sourceName,
          connectorName: "workday",
          token,
          boardUrl,
          status: "ACTIVE",
          validationState: "VALIDATED",
          pollState: "READY",
          sourceType: "ATS",
          extractionRoute: "ATS_NATIVE",
          parserVersion: "workday-token-import:v1",
          pollingCadenceMinutes: DEFAULT_POLL_CADENCE_MINUTES,
          priorityScore: 0.95,
          sourceQualityScore: 0.80,
          yieldScore: 0.55,
          firstSeenAt: now,
          lastProvisionedAt: now,
          lastDiscoveryAt: now,
          lastSuccessfulPollAt: fourHoursAgo,
          lastValidatedAt: now,
          consecutiveFailures: 0,
          failureStreak: 0,
        },
        update: {
          boardUrl,
          status: "ACTIVE",
          validationState: "VALIDATED",
          pollState: "READY",
          sourceType: "ATS",
          extractionRoute: "ATS_NATIVE",
          parserVersion: "workday-token-import:v1",
          pollingCadenceMinutes: DEFAULT_POLL_CADENCE_MINUTES,
          priorityScore: 0.95,
          sourceQualityScore: 0.80,
          yieldScore: 0.55,
          lastDiscoveryAt: now,
          lastSuccessfulPollAt: fourHoursAgo,
          lastValidatedAt: now,
          consecutiveFailures: 0,
          failureStreak: 0,
          validationMessage: null,
        },
      });

      if (existingBefore) {
        updated++;
        console.log(`  -> updated existing CompanySource for company ${company.id}`);
      } else {
        created++;
        console.log(`  -> created new CompanySource for company ${company.id}`);
      }
    } catch (err) {
      failed++;
      console.error(`  -> ERROR processing ${token}:`, err);
    }
  }

  console.log("\n[add-workday-tokens] Done.");
  console.log(`  created: ${created}`);
  console.log(`  updated: ${updated}`);
  console.log(`  failed:  ${failed}`);
  console.log(`  total:   ${entries.length}`);
}

main()
  .catch((err) => {
    console.error("[add-workday-tokens] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
