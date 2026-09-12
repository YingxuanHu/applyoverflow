import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

export type ResourceKind = "ai" | "pdf";
const POLICIES = {
  ai: { perUser: 100, global: 2000, concurrency: 8 },
  pdf: { perUser: 20, global: 500, concurrency: 2 },
} as const;

export class ResourceBudgetError extends Error {
  constructor() {
    super("Generation capacity is temporarily unavailable. Please try again later.");
    this.name = "ResourceBudgetError";
  }
}

/** Shared across routes, actions and replicas. Failed attempts still consume
 * quota; leases expire after a crash. No database connection is held during work. */
export async function withResourceBudget<T>(
  resource: ResourceKind,
  subject: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!subject.trim()) throw new ResourceBudgetError();
  const policy = POLICIES[resource];
  const leaseId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`resource-budget:${resource}`}))`;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const now = clock.now;
    await tx.resourceLease.deleteMany({ where: { resource, expiresAt: { lte: now } } });
    const active = await tx.resourceLease.count({ where: { resource } });
    if (active >= policy.concurrency) throw new ResourceBudgetError();
    for (const [key, limit] of [[`${resource}:global`, policy.global], [`${resource}:user:${subject}`, policy.perUser]] as const) {
      const existing = await tx.resourceBudget.findUnique({ where: { key } });
      const fresh = !existing || existing.resetAt <= now;
      if (!fresh && existing.used >= limit) throw new ResourceBudgetError();
      await tx.resourceBudget.upsert({
        where: { key },
        create: { key, used: 1, resetAt: new Date(now.getTime() + 3600_000) },
        update: fresh ? { used: 1, resetAt: new Date(now.getTime() + 3600_000) } : { used: { increment: 1 } },
      });
    }
    await tx.resourceLease.create({ data: { id: leaseId, resource, expiresAt: new Date(now.getTime() + 5 * 60_000) } });
  }, { timeout: 10_000 });
  try {
    return await work();
  } finally {
    await prisma.resourceLease.deleteMany({ where: { id: leaseId } });
  }
}
