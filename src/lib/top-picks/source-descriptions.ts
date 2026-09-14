import { prisma } from "@/lib/db";

const cache = new Map<
  string,
  { version: number; description: string; bytes: number }
>();
let cacheBytes = 0;
const MAX_BYTES = 16 * 1024 * 1024;

// Only background ranking calls this. Shared versioned entries avoid refetching
// source descriptions for each user; no extra description copies go into Postgres.
export async function loadScoringDescriptions(
  jobs: Array<{ id: string; updatedAt: Date }>,
) {
  const output = new Map<string, string>();
  const missing = jobs.filter((job) => {
    const entry = cache.get(job.id);
    if (entry?.version !== job.updatedAt.getTime()) return true;
    output.set(job.id, entry.description);
    return false;
  });
  for (let offset = 0; offset < missing.length; offset += 40) {
    const batch = missing.slice(offset, offset + 40);
    const rows = await prisma.jobCanonical.findMany({
      where: { id: { in: batch.map((job) => job.id) } },
      select: { id: true, updatedAt: true, description: true },
    });
    for (const row of rows) {
      if (
        row.updatedAt.getTime() !==
        batch.find((job) => job.id === row.id)?.updatedAt.getTime()
      )
        continue;
      const description = row.description ?? "";
      const bytes = description.length * 2;
      if (bytes > 1_000_000) continue;
      output.set(row.id, description);
      const old = cache.get(row.id);
      if (old) {
        cacheBytes -= old.bytes;
        cache.delete(row.id);
      }
      while (cacheBytes + bytes > MAX_BYTES || cache.size >= 2000) {
        const first = cache.keys().next().value;
        if (!first) break;
        cacheBytes -= cache.get(first)!.bytes;
        cache.delete(first);
      }
      cache.set(row.id, {
        version: row.updatedAt.getTime(),
        description,
        bytes,
      });
      cacheBytes += bytes;
    }
  }
  return output;
}
