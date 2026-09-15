import "dotenv/config";
import { mkdir, readFile, readdir, rename, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";

type RelationSize = { name: string; totalBytes: number; indexBytes: number; estimatedLiveRows: number; estimatedDeadRows: number };
type Snapshot = { capturedAt: string; relations: RelationSize[] };

async function main() {
  const directory = path.resolve(process.env.STORAGE_GROWTH_HISTORY_DIR ?? "logs/storage-growth");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const relations = await prisma.$transaction(async (db) => {
    await db.$executeRaw`SET TRANSACTION READ ONLY`;
    await db.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    await db.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
    const rows = await db.$queryRaw<Array<{ name: string; totalBytes: bigint; indexBytes: bigint; estimatedLiveRows: bigint; estimatedDeadRows: bigint }>>`
      SELECT relname AS name, pg_total_relation_size(relid) AS "totalBytes",
        pg_indexes_size(relid) AS "indexBytes", n_live_tup AS "estimatedLiveRows", n_dead_tup AS "estimatedDeadRows"
      FROM pg_stat_user_tables WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(relid) DESC, relname
    `;
    return rows.map((row) => ({ ...row, totalBytes: Number(row.totalBytes), indexBytes: Number(row.indexBytes), estimatedLiveRows: Number(row.estimatedLiveRows), estimatedDeadRows: Number(row.estimatedDeadRows) }));
  }, { timeout: 8000 });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  const previousFile = files.filter((name) => name < `${day}.json`).at(-1);
  let previous: Snapshot | null = null;
  if (previousFile) {
    try { previous = JSON.parse(await readFile(path.join(directory, previousFile), "utf8")) as Snapshot; }
    catch { console.warn("Previous storage snapshot unreadable; growth is unavailable."); }
  }
  const elapsedDays = previous ? (now.getTime() - Date.parse(previous.capturedAt)) / 86_400_000 : 0;
  const growth = relations.map((row) => {
    const old = previous?.relations?.find((entry) => entry.name === row.name);
    const bytesPerDay = old && elapsedDays > 0 ? Math.round((row.totalBytes - old.totalBytes) / elapsedDays) : null;
    return { ...row, bytesPerDay };
  }).sort((a, b) => (b.bytesPerDay ?? 0) - (a.bytesPerDay ?? 0));
  const filesystems = [];
  for (const mount of ["/", process.env.STORAGE_VOLUME_PATH].filter((value): value is string => Boolean(value))) {
    try {
      const stats = await statfs(mount);
      filesystems.push({ mount, totalBytes: stats.blocks * stats.bsize, availableBytes: stats.bavail * stats.bsize });
    } catch { filesystems.push({ mount, error: "Mount unavailable" }); }
  }
  const snapshot: Snapshot = { capturedAt: now.toISOString(), relations };
  const temporary = path.join(directory, `${day}.${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(temporary, path.join(directory, `${day}.json`));
  // Only this tool's dated telemetry, never database files or backups.
  for (const file of files) {
    if (Date.parse(file.slice(0, 10)) < now.getTime() - 90 * 86_400_000) await unlink(path.join(directory, file));
  }
  console.log(JSON.stringify({ capturedAt: snapshot.capturedAt, comparedWith: previous?.capturedAt ?? null, filesystems, growth, note: "Catalog estimates; deletions may create reusable database space without reducing filesystem size." }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
