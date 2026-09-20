import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { databaseSourceHostGate, SourceHostRateLimitError } from "../../src/lib/ingestion/host-rate-limit";
import { claimSourceTasks, deferRateLimitedSourceTask, deferSharedHostPollTasks } from "../../src/lib/ingestion/task-queue";
import { ingestConnector } from "../../src/lib/ingestion/pipeline";
import { runSourceValidationQueue } from "../../src/lib/ingestion/company-discovery";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  assert.notEqual(process.env.NODE_ENV, "production");
  // The provider clock is shared: don't disturb existing development work.
  assert.equal(await prisma.sourceTask.count({where:{companySource:{connectorName:"workable"},status:{in:["PENDING","RUNNING"]}}}), 0);
  const key = "ingestion-host:www.workable.com";
  assert.equal(await prisma.resourceBudget.count({where:{key}}), 0);
  const token = `host-queue-fixture-${randomUUID()}`;
  const priorFlag = process.env.INGEST_SHARED_HOST_LIMITS;
  process.env.INGEST_SHARED_HOST_LIMITS = "1";
  const company = await prisma.company.create({data:{name:token,companyKey:token}});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No provider requests allowed in queue fixture"); };
  try {
    const source = await prisma.companySource.create({data:{
      companyId:company.id,connectorName:"workable",sourceName:`Workable:${token}`,token,
      boardUrl:`https://apply.workable.com/${token}/`,status:"ACTIVE",validationState:"VALIDATED",
      pollState:"READY",failureStreak:2,sourceQualityScore:0.8,
    }});
    const task = await prisma.sourceTask.create({data:{companyId:company.id,companySourceId:source.id,
      kind:"CONNECTOR_POLL",status:"PENDING",notBeforeAt:new Date(0),priorityScore:250000}});
    await databaseSourceHostGate.defer("www.workable.com", 120000);
    const clock = await prisma.resourceBudget.findUniqueOrThrow({where:{key}});
    assert.equal(await deferSharedHostPollTasks(), 1);
    const delayed = await prisma.sourceTask.findUniqueOrThrow({where:{id:task.id}});
    assert.equal(delayed.notBeforeAt.getTime(),clock.resetAt.getTime());
    assert.equal(delayed.attemptCount,0);
    const options = {companySourceIds:[source.id],limit:1};
    assert.equal((await claimSourceTasks("CONNECTOR_POLL",1,new Date(),options)).length,0);
    await assert.rejects(ingestConnector({key:`workable:${token}`,sourceName:source.sourceName,sourceTier:"TIER_2",freshnessMode:"FULL_SNAPSHOT",fetchJobs:async()=>{throw new Error("must never fetch");}}), SourceHostRateLimitError);
    assert.equal(await prisma.ingestionRun.count({where:{connectorKey:`workable:${token}`}}),0);
    assert.deepEqual(await prisma.companySource.findUnique({where:{id:source.id}}),source, "cooldown cannot penalize source health");

    // Even an explicitly requeued high-priority task cannot bypass the clock.
    await prisma.sourceTask.update({where:{id:task.id},data:{notBeforeAt:new Date(0)}});
    assert.equal((await claimSourceTasks("CONNECTOR_POLL",1,new Date(),options)).length,0);
    await prisma.resourceBudget.update({where:{key},data:{resetAt:new Date(0)}});
    await prisma.sourceTask.update({where:{id:task.id},data:{notBeforeAt:new Date(0)}});
    const [claimed] = await claimSourceTasks("CONNECTOR_POLL",1,new Date(),options);
    assert.ok(claimed);
    assert.equal(claimed.attemptCount,1);
    await databaseSourceHostGate.defer("www.workable.com",180000);
    const next = await prisma.resourceBudget.findUniqueOrThrow({where:{key}});
    assert.equal(await deferRateLimitedSourceTask(claimed,new SourceHostRateLimitError("www.workable.com",next.resetAt)),true);
    const released = await prisma.sourceTask.findUniqueOrThrow({where:{id:task.id}});
    assert.equal(released.status,"PENDING");
    assert.equal(released.startedAt,null);
    assert.equal(released.attemptCount,0);
    assert.equal(released.notBeforeAt.getTime(),next.resetAt.getTime());
    assert.deepEqual(await prisma.companySource.findUnique({where:{id:source.id}}),source);
    const validation = await prisma.sourceTask.create({data:{companyId:company.id,companySourceId:source.id,
      kind:"SOURCE_VALIDATION",status:"PENDING",notBeforeAt:new Date(0)}});
    assert.equal((await runSourceValidationQueue(options)).failedCount,0);
    assert.deepEqual(await prisma.companySource.findUnique({where:{id:source.id}}),source);
    assert.equal((await prisma.sourceTask.findUniqueOrThrow({where:{id:validation.id}})).status,"PENDING");
    console.log("PASS: shared deadline defers claims, zero network/runs/health penalties, expiry permits claim, racing cooldown releases lease without attempt penalty");
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.company.delete({where:{id:company.id}});
    await prisma.resourceBudget.deleteMany({where:{key}});
    if (priorFlag === undefined) delete process.env.INGEST_SHARED_HOST_LIMITS;
    else process.env.INGEST_SHARED_HOST_LIMITS = priorFlag;
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
