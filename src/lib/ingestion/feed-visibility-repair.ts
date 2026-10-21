import { Prisma } from "@/generated/prisma/client";

export function buildFeedVisibilityRepair(rows: Array<{
  id: string;
  canonicalUpdatedAt: Date;
  indexUpdatedAt: Date;
}>) {
  // Only change the search projection. Concurrent ingestion wins over an old
  // assessment, and saved jobs, source mappings and applications stay intact.
  return Prisma.sql`
    UPDATE "JobFeedIndex" jfi
    SET status = 'REMOVED'::"JobStatus", "indexedAt" = NOW(), "updatedAt" = NOW()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS candidate(id text, "canonicalUpdatedAt" timestamp, "indexUpdatedAt" timestamp),
      "JobCanonical" jc
    WHERE jfi."canonicalJobId" = candidate.id
      AND jc.id = candidate.id
      AND jc."updatedAt" = candidate."canonicalUpdatedAt"
      AND jfi."updatedAt" = candidate."indexUpdatedAt"
      AND jfi.status = 'LIVE'::"JobStatus"
  `;
}
