import { Prisma } from "@/generated/prisma/client";
import { buildLocationSearchPredicate } from "@/lib/location-search";

type LocationPredicate = NonNullable<ReturnType<typeof buildLocationSearchPredicate>>;

function renderLocationPredicate(where: LocationPredicate): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (where.location) clauses.push(Prisma.sql`jfi.location ILIKE ${`%${where.location.contains}%`}`);
  if (where.region) clauses.push(Prisma.sql`jfi.region = ${where.region}::"Region"`);
  if (where.AND) clauses.push(Prisma.sql`(${Prisma.join(where.AND.map(renderLocationPredicate), " AND ")})`);
  if (where.OR) clauses.push(Prisma.sql`(${Prisma.join(where.OR.map(renderLocationPredicate), " OR ")})`);
  return Prisma.sql`(${Prisma.join(clauses, " AND ")})`;
}

// Reuse the same country/subdivision/city expansion and literal escaping as
// Prisma. The raw query must not broaden a compound location into OR terms.
export function buildFeedLocationSql(query?: string): Prisma.Sql {
  const where = buildLocationSearchPredicate(query);
  return where ? renderLocationPredicate(where) : Prisma.sql`TRUE`;
}
