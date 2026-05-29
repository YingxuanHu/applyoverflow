import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const exact = process.argv.includes("--exact");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const trackedTables = [
  "User",
  "UserProfile",
  "Document",
  "DocumentAnalysis",
  "JobCanonical",
  "JobRaw",
  "NormalizedJobRecord",
  "JobSourceMapping",
  "JobFeedIndex",
  "Company",
  "CompanySource",
  "ATSTenant",
  "SourceCandidate",
  "SourceTask",
  "IngestionRun",
  "SavedJob",
  "TrackedApplication",
  "TrackedApplicationDocument",
  "TrackedApplicationTag",
  "Notification",
  "ReminderLog",
];

async function getEstimatedCounts() {
  const quotedNames = trackedTables.map((name) => `'${name.replace(/'/g, "''")}'`).join(",");
  const rows = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; estimated_rows: string }>
  >(
    `
      select relname as table_name, coalesce(n_live_tup, 0)::bigint::text as estimated_rows
      from pg_stat_user_tables
      where relname in (${quotedNames})
    `
  );

  return Object.fromEntries(
    rows.map((row) => [row.table_name, Number(row.estimated_rows)])
  );
}

async function getExactCriticalCounts() {
  const [
    users,
    userProfiles,
    documents,
    documentAnalyses,
    savedJobs,
    trackedApplications,
    trackedApplicationDocuments,
    trackedApplicationTags,
    notifications,
    reminderLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.userProfile.count(),
    prisma.document.count(),
    prisma.documentAnalysis.count(),
    prisma.savedJob.count(),
    prisma.trackedApplication.count(),
    prisma.trackedApplicationDocument.count(),
    prisma.trackedApplicationTag.count(),
    prisma.notification.count(),
    prisma.reminderLog.count(),
  ]);

  return {
    users,
    userProfiles,
    documents,
    documentAnalyses,
    savedJobs,
    trackedApplications,
    trackedApplicationDocuments,
    trackedApplicationTags,
    notifications,
    reminderLogs,
  };
}

async function getExactAllCounts() {
  const [
    users,
    userProfiles,
    documents,
    documentAnalyses,
    canonicalJobs,
    rawJobs,
    normalizedJobRecords,
    jobSourceMappings,
    jobFeedIndexRows,
    companies,
    companySources,
    atsTenants,
    sourceCandidates,
    sourceTasks,
    ingestionRuns,
    savedJobs,
    trackedApplications,
    trackedApplicationDocuments,
    trackedApplicationTags,
    notifications,
    reminderLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.userProfile.count(),
    prisma.document.count(),
    prisma.documentAnalysis.count(),
    prisma.jobCanonical.count(),
    prisma.jobRaw.count(),
    prisma.normalizedJobRecord.count(),
    prisma.jobSourceMapping.count(),
    prisma.jobFeedIndex.count(),
    prisma.company.count(),
    prisma.companySource.count(),
    prisma.aTSTenant.count(),
    prisma.sourceCandidate.count(),
    prisma.sourceTask.count(),
    prisma.ingestionRun.count(),
    prisma.savedJob.count(),
    prisma.trackedApplication.count(),
    prisma.trackedApplicationDocument.count(),
    prisma.trackedApplicationTag.count(),
    prisma.notification.count(),
    prisma.reminderLog.count(),
  ]);

  return {
    users,
    userProfiles,
    documents,
    documentAnalyses,
    canonicalJobs,
    rawJobs,
    normalizedJobRecords,
    jobSourceMappings,
    jobFeedIndexRows,
    companies,
    companySources,
    atsTenants,
    sourceCandidates,
    sourceTasks,
    ingestionRuns,
    savedJobs,
    trackedApplications,
    trackedApplicationDocuments,
    trackedApplicationTags,
    notifications,
    reminderLogs,
  };
}

async function main() {
  const [sizeRows, estimatedCounts, criticalCounts] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ size: string }>>(
      "select pg_size_pretty(pg_database_size(current_database())) as size"
    ),
    getEstimatedCounts(),
    getExactCriticalCounts(),
  ]);

  console.log(
    JSON.stringify(
      {
        mode: exact ? "exact" : "quick",
        databaseSize: sizeRows[0]?.size ?? null,
        capturedAt: new Date().toISOString(),
        exactCriticalCounts: criticalCounts,
        estimatedCounts,
        exactCounts: exact ? await getExactAllCounts() : undefined,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
