import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBoundedMaintenanceClient, prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { buildSourceRecoveryReportQuery } from "../../src/lib/ingestion/source-recovery-report";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
  const id = `source-recovery-${randomUUID()}`;
  const maintenance = createBoundedMaintenanceClient();
  try {
    const [limits] = await maintenance.$queryRaw<Array<{ statement: string; lock: string }>>`SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock`;
    assert.deepEqual(limits, { statement: "1min", lock: "1s" });
    await prisma.company.create({ data: { id, name: "Recovery fixture", companyKey: id } });
    const old = new Date(Date.now() - 8 * 86_400_000);
    const future = new Date(Date.now() + 2 * 3_600_000);
    const states = ["missing-poll-task", "cooldown", "waiting-for-worker", "scheduled", "running-over-30min", "manual-review", "upstream-access-review"];
    for (const [index, state] of states.entries()) {
      const sourceId = `${id}-${index}`;
      await prisma.companySource.create({ data: { id: sourceId, companyId: id, sourceName: sourceId, connectorName: "greenhouse", token: sourceId, boardUrl: "https://example.test/jobs", status: "ACTIVE", pollState: state === "manual-review" ? "QUARANTINED" : "READY", retainedLiveJobCount: 1000000, lastSuccessfulPollAt: old, cooldownUntil: state === "cooldown" ? future : null, lastHttpStatus: state === "upstream-access-review" ? 403 : null, lastFailureAt: state === "upstream-access-review" ? new Date() : null } });
      if (["waiting-for-worker", "scheduled", "running-over-30min"].includes(state)) {
        await prisma.sourceTask.create({ data: { companySourceId: sourceId, kind: "CONNECTOR_POLL", status: state === "running-over-30min" ? "RUNNING" : "PENDING", notBeforeAt: state === "scheduled" ? future : old, startedAt: state === "running-over-30min" ? old : null } });
      }
    }
    const rows = await maintenance.$queryRaw<Array<{ id: string; recoveryReason: string }>>(buildSourceRecoveryReportQuery());
    for (const [index, state] of states.entries()) assert.equal(rows.find((row) => row.id === `${id}-${index}`)?.recoveryReason, state);
    console.log("PASS: source recovery categories and dedicated maintenance timeouts");
  } finally {
    await prisma.sourceTask.deleteMany({ where: { companySourceId: { startsWith: `${id}-` } } });
    await prisma.company.deleteMany({ where: { id } });
    await maintenance.$disconnect();
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
