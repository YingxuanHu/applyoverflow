import { Prisma } from "@/generated/prisma/client";

// Reuse unchanged values from the existing row, especially its TOAST pointers.
// Sending an identical large search/metadata value through a normal upsert can
// otherwise allocate another compressed value on every source heartbeat.
export function buildFeedIndexWrite(
  projection: Prisma.JobFeedIndexUncheckedCreateInput,
  canonicalUpdatedAt: Date,
) {
  const columns = Object.keys(projection).map((name) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error("Invalid feed column");
    return Prisma.raw(`"${name}"`);
  });
  const mutable = columns.filter((column) => column.sql !== '"canonicalJobId"');
  const assignments = mutable.map((column) => Prisma.sql`
    ${column} = CASE
      WHEN current.${column} IS DISTINCT FROM EXCLUDED.${column}
      THEN EXCLUDED.${column} ELSE current.${column} END
  `);
  return Prisma.sql`
    INSERT INTO "JobFeedIndex" AS current (${Prisma.join(columns)})
    SELECT ${Prisma.join(columns.map((column) => Prisma.sql`incoming.${column}`))}
    FROM jsonb_populate_record(NULL::"JobFeedIndex", ${JSON.stringify(projection)}::jsonb) incoming
    WHERE EXISTS (
      SELECT 1 FROM "JobCanonical" jc
      WHERE jc.id = incoming."canonicalJobId" AND jc."updatedAt" = ${canonicalUpdatedAt}
    )
    ON CONFLICT ("canonicalJobId") DO UPDATE SET ${Prisma.join(assignments)}
    WHERE current."indexedAt" <= EXCLUDED."indexedAt"
      AND ROW(${Prisma.join(mutable.map((column) => Prisma.sql`current.${column}`))})
        IS DISTINCT FROM ROW(${Prisma.join(mutable.map((column) => Prisma.sql`EXCLUDED.${column}`))})
  `;
}
