import { sleepWithAbort, throwIfAborted } from "@/lib/ingestion/runtime-control";

export function sharedSourceHostLimitsEnabled() {
  return process.env.INGEST_SHARED_HOST_LIMITS === "1" ||
    (process.env.NODE_ENV === "production" && process.env.INGEST_SHARED_HOST_LIMITS !== "0");
}

// The board URL is apply.workable.com, but all tenants share this API host.
export const SHARED_CONNECTOR_HOSTS: Readonly<Record<string, string>> = {
  workable: "www.workable.com",
};

export async function assertSourceHostReady(connectorName: string) {
  const host = SHARED_CONNECTOR_HOSTS[connectorName.toLowerCase()];
  if (!host || !sharedSourceHostLimitsEnabled()) return;
  const { prisma } = await import("@/lib/db");
  const [budget] = await prisma.$queryRaw<Array<{ resetAt: Date }>>`
    SELECT "resetAt" FROM "ResourceBudget"
    WHERE "key" = ${`ingestion-host:${host}`} AND "used" = 2
      AND "resetAt" > clock_timestamp()
  `;
  if (budget) throw new SourceHostRateLimitError(host, budget.resetAt);
}

export class SourceHostRateLimitError extends Error {
  constructor(public readonly host: string, public readonly retryAt: Date) {
    super(`429 shared source-host cooldown for ${host}; retry after ${retryAt.toISOString()}`);
  }
}

export function retryAfterMs(value: string | null, now = Date.now()) {
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value ?? "") - now;
  // Invalid/missing hints still back off; never retry earlier than a valid hint.
  return Number.isFinite(duration) && duration > 0 ? Math.max(30_000, duration) : 60_000;
}

export type SourceHostGate = {
  reserve(host: string): Promise<{ waitMs: number; retryAt?: Date }>;
  defer(host: string, durationMs: number): Promise<void>;
};

// ResourceBudget keys in this namespace store a host clock, not an AI quota.
// used=1 is request spacing; used=2 is an upstream 429 cooldown. Transactions
// are short and never hold a database connection during network activity.
export const databaseSourceHostGate: SourceHostGate = {
  async reserve(host) {
    const { prisma } = await import("@/lib/db");
    const key = `ingestion-host:${host}`;
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const existing = await tx.resourceBudget.findUnique({ where: { key } });
      const waitMs = existing ? existing.resetAt.getTime() - clock.now.getTime() : 0;
      if (existing && waitMs > 0) {
        return { waitMs, ...(existing.used === 2 ? { retryAt: existing.resetAt } : {}) };
      }
      const resetAt = new Date(clock.now.getTime() + 1000);
      await tx.resourceBudget.upsert({ where: { key },
        create: { key, used: 1, resetAt }, update: { used: 1, resetAt } });
      return { waitMs: 0 };
    });
  },
  async defer(host, durationMs) {
    const { prisma } = await import("@/lib/db");
    const key = `ingestion-host:${host}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const existing = await tx.resourceBudget.findUnique({ where: { key } });
      const resetAt = new Date(Math.min(8.64e15, Math.max(
        clock.now.getTime() + durationMs, existing?.resetAt.getTime() ?? 0,
      )));
      await tx.resourceBudget.upsert({ where: { key },
        create: { key, used: 2, resetAt }, update: { used: 2, resetAt } });
    });
  },
};

export async function fetchWithSourceHostGate(
  url: string, init: RequestInit = {}, gate?: SourceHostGate,
): Promise<Response> {
  const enabled = sharedSourceHostLimitsEnabled();
  const activeGate = gate ?? (enabled ? databaseSourceHostGate : null);
  if (!activeGate) return fetch(url, init);
  const host = new URL(url).hostname.toLowerCase();
  const signal = init.signal ?? undefined;
  while (true) {
    throwIfAborted(signal);
    const slot = await activeGate.reserve(host);
    if (slot.retryAt) throw new SourceHostRateLimitError(host, slot.retryAt);
    if (slot.waitMs <= 0) break;
    await sleepWithAbort(slot.waitMs, signal);
  }
  throwIfAborted(signal);
  const response = await fetch(url, init);
  if (response.status === 429) {
    const durationMs = retryAfterMs(response.headers.get("retry-after"));
    await activeGate.defer(host, durationMs);
    await response.body?.cancel();
    const slot = await activeGate.reserve(host);
    throw new SourceHostRateLimitError(host, slot.retryAt ?? new Date(Date.now() + durationMs));
  }
  return response;
}
