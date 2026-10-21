import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assessJobDataQuality } from "@/lib/ingestion/job-data-quality";
import { isExcludedJobTitle } from "@/lib/jobs/scope-policy";
import { isClearlyNonNorthAmericanJobLocation } from "@/lib/geo-scope";

// Read-only audit. --input accepts an exported JSON array of public job rows,
// allowing production inspection without transferring database credentials.
const snapshotDate = z.preprocess((value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value}Z` : value,
z.coerce.date().nullable());
const rowSchema = z.object({
  id: z.string(), title: z.string(), company: z.string(), description: z.string(),
  shortSummary: z.string(), location: z.string(), region: z.enum(["US", "CA"]).nullable(),
  workMode: z.string(), applyUrl: z.string(), status: z.string(),
  sourceCount: z.number(), availabilityScore: z.number(),
  titleConfidence: z.number().nullable(), titleStatus: z.string().nullable(),
  descriptionStatus: z.string().nullable(), applyUrlValidationStatus: z.string().nullable(),
  deadline: snapshotDate, deadSignalAt: snapshotDate,
  lastSourceSeenAt: snapshotDate, lastConfirmedAliveAt: snapshotDate,
});

function option(name: string) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function limit(name: string, fallback: number, maximum: number) {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`Invalid --${name}; expected 0-${maximum}.`);
  return value;
}

async function main() {
  const input = option("input");
  const size = limit("sample-size", 300, 2000);
  const liveLimit = limit("live-checks", 0, 100);
  const output = option("out") ?? "output/audits/live-job-quality.json";
  const now = new Date();
  // No database connection is made in exported-snapshot mode.
  if (input) process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost/unused";
  const { prisma } = await import("@/lib/db");
  const { shouldExcludeFromFeedIndex } = await import("@/lib/ingestion/search-index");
  const { checkUrlHealth } = await import("@/lib/ingestion/health-checker");
  try {
    const rawRows = input ? JSON.parse(await readFile(input, "utf8")) : await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
      // Bound both the indexed lookup and canonical hydration; no full-table
      // description scan and no mutation, even when --live-checks is enabled.
      const ids = await tx.jobFeedIndex.findMany({ where: { status: "LIVE" }, orderBy: [{ postedAt: "desc" }, { canonicalJobId: "desc" }], take: size, select: { canonicalJobId: true } });
      const rows = await tx.jobCanonical.findMany({ where: { id: { in: ids.map((row) => row.canonicalJobId) } }, select: {
        id: true, title: true, company: true, description: true, shortSummary: true,
        location: true, region: true, workMode: true, applyUrl: true, status: true,
        availabilityScore: true, titleConfidence: true, titleStatus: true,
        descriptionStatus: true, applyUrlValidationStatus: true, deadline: true,
        deadSignalAt: true, lastSourceSeenAt: true, lastConfirmedAliveAt: true,
        feedIndex: { select: { sourceCount: true } },
      } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.flatMap(({ canonicalJobId }) => {
        const row = byId.get(canonicalJobId);
        return row ? [{ ...row, sourceCount: row.feedIndex?.sourceCount ?? 0 }] : [];
      });
    }, { timeout: 45_000 });
    const rows = z.array(rowSchema).parse(rawRows).slice(0, size);
    const assessments = rows.map((row) => ({
      id: row.id, title: row.title, company: row.company, applyUrl: row.applyUrl,
      excludedByCurrentGate: shouldExcludeFromFeedIndex({ ...row, now }),
      outOfScopeRole: isExcludedJobTitle(row.title),
      outOfScopeLocation: isClearlyNonNorthAmericanJobLocation(row),
      qualityIssues: assessJobDataQuality(row).issues,
      sourceAgeDays: row.lastSourceSeenAt ? (now.getTime() - row.lastSourceSeenAt.getTime()) / 86_400_000 : null,
      confirmationAgeDays: row.lastConfirmedAliveAt ? (now.getTime() - row.lastConfirmedAliveAt.getTime()) / 86_400_000 : null,
    }));
    // Round-robin hosts so one large employer doesn't consume the live sample.
    const hosts = new Map<string, typeof rows>();
    for (const row of rows) {
      try {
        const host = new URL(row.applyUrl).hostname;
        const group = hosts.get(host) ?? [];
        group.push(row); hosts.set(host, group);
      } catch { /* Invalid URLs remain reported by the publication gate. */ }
    }
    const liveChecks = [];
    while (liveChecks.length < liveLimit && hosts.size) {
      for (const [host, group] of hosts) {
        if (liveChecks.length >= liveLimit) break;
        const row = group.shift()!;
        if (!group.length) hosts.delete(host);
        const outcome = await checkUrlHealth({ url: row.applyUrl, urlType: "APPLY", deadline: row.deadline, title: row.title, company: row.company, description: row.description, now: new Date() });
        liveChecks.push({ id: row.id, host, url: row.applyUrl, result: outcome.result, statusCode: outcome.statusCode, reason: outcome.validationReason ?? outcome.closureReason, finalUrl: outcome.finalUrl });
        console.error(`[quality-audit] ${liveChecks.length}/${liveLimit} ${host}: ${outcome.result}`);
      }
    }
    const results: Record<string, number> = {};
    for (const check of liveChecks) results[check.result] = (results[check.result] ?? 0) + 1;
    const report = {
      generatedAt: now.toISOString(), readOnly: true,
      sampling: input ? "Exported snapshot, capped by sample-size; not a population estimate." : "Newest indexed LIVE jobs; not a population estimate.",
      scanned: rows.length,
      gateFailures: assessments.filter((row) => row.excludedByCurrentGate).length,
      sourceConfirmedWithin3Days: assessments.filter((row) => row.sourceAgeDays !== null && row.sourceAgeDays <= 3).length,
      sourceOlderThan14DaysOrMissing: assessments.filter((row) => row.sourceAgeDays === null || row.sourceAgeDays > 14).length,
      liveCheckResults: results,
      verificationNote: "BLOCKED, ERROR and SUSPECT are unverified, not confirmed open or closed. A source poll is distinct from checking the application page.",
      assessments, liveChecks,
    };
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ ...report, assessments: undefined, liveChecks: undefined, output }, null, 2));
    if (process.argv.includes("--fail-on-issues") && (report.gateFailures || liveChecks.some((row) => row.result !== "ALIVE"))) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
