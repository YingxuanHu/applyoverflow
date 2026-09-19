import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { buildOverdueConnectorPollClaimQuery } from "../../src/lib/ingestion/task-queue";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
  const now = new Date("2026-09-18T22:00:00Z");
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  try {
    await prisma.$transaction(async (tx) => {
      // Connection-local tables exercise the real claim SQL without touching queued work.
      await tx.$executeRaw`CREATE TEMP TABLE "CompanySource" (
        id text PRIMARY KEY, "connectorName" text, status text,
        "validationState" text, "pollState" text, "cooldownUntil" timestamptz
      ) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE "SourceTask" (
        id text PRIMARY KEY, "companySourceId" text, kind "SourceTaskKind",
        status "SourceTaskStatus", "notBeforeAt" timestamptz,
        "priorityScore" double precision, "attemptCount" int DEFAULT 0, "startedAt" timestamptz
      ) ON COMMIT DROP`;
      const samples = [
        { id: "oldest", age: 32 },
        { id: "second", age: 30 },
        { id: "boundary", age: 24 },
        { id: "fresh-priority", age: 1, priority: 300000 },
        { id: "future", age: -1 },
        { id: "cooling", age: 50, cooldown: ago(-1) },
        { id: "disabled", age: 50, status: "DISABLED" },
        { id: "unvalidated", age: 50, validation: "UNVALIDATED" },
        { id: "quarantined", age: 50, poll: "QUARANTINED" },
        { id: "poll-disabled", age: 50, poll: "DISABLED" },
        { id: "excluded-family", age: 50, connector: "blocked" },
        { id: "running", age: 50, taskStatus: "RUNNING" },
        { id: "other-kind", age: 50, kind: "SOURCE_VALIDATION" },
      ];
      for (const s of samples) {
        await tx.$executeRaw`INSERT INTO "CompanySource" VALUES
          (${s.id}, ${s.connector ?? "workday"}, ${s.status ?? "ACTIVE"},
           ${s.validation ?? "VALIDATED"}, ${s.poll ?? "READY"}, ${s.cooldown ?? null})`;
        await tx.$executeRaw`INSERT INTO "SourceTask"
          (id,"companySourceId",kind,status,"notBeforeAt","priorityScore") VALUES
          (${s.id},${s.id},${s.kind ?? "CONNECTOR_POLL"}::"SourceTaskKind",
           ${s.taskStatus ?? "PENDING"}::"SourceTaskStatus",${ago(s.age)},${s.priority ?? 70})`;
      }
      const claim = (limit: number) =>
        tx.$queryRaw<Array<{ id: string }>>(
          buildOverdueConnectorPollClaimQuery(limit, now, ["blocked"]),
        );
      assert.deepEqual(
        (await claim(1)).map((r) => r.id),
        ["oldest"],
      );
      assert.deepEqual((await claim(10)).map((r) => r.id).sort(), [
        "boundary",
        "second",
      ]);
      assert.deepEqual(
        await claim(10),
        [],
        "claims cannot be repeated or bypass protected sources",
      );
      const [row] = await tx.$queryRaw<
        Array<{ attempts: number; started: Date }>
      >(Prisma.sql`
        SELECT "attemptCount" AS attempts, "startedAt" AS started FROM "SourceTask" WHERE id='oldest'
      `);
      assert.equal(row.attempts, 1);
      assert.equal(row.started.getTime(), now.getTime());
    });
    console.log(
      "PASS: oldest-first quota, cutoff, attempt tracking, no reclaims, cooldown/eligibility/family exclusions",
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
