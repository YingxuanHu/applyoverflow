import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { withResourceBudget, ResourceBudgetError } from "../../src/lib/resource-budget";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  const subject = `test:${randomUUID()}`;
  const key = `ai:user:${subject}`;
  let entered = false;
  try {
    await prisma.resourceBudget.create({ data: { key, used: 100, resetAt: new Date(Date.now() + 3600_000) } });
    await assert.rejects(withResourceBudget("ai", subject, async () => { entered = true; }), ResourceBudgetError);
    assert.equal(entered, false, "quota rejects before generation");
    await prisma.resourceBudget.delete({ where: { key } });
    await assert.rejects(withResourceBudget("ai", subject, async () => { throw new Error("simulated provider failure"); }), /simulated provider failure/);
    assert.equal(await prisma.resourceLease.count({ where: { resource: "ai" } }), 0, "failure releases lease");
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => withResourceBudget("ai", subject, () => new Promise((resolve) => setTimeout(resolve, 1500)))));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 8, "atomic global concurrency");
    assert.equal(await prisma.resourceLease.count({ where: { resource: "ai" } }), 0);
    console.log("PASS: shared quota, concurrency and failure release (no provider requests)");
  } finally {
    await prisma.resourceBudget.deleteMany({ where: { key } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
