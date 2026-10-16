import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { onboardingEventSchema, type OnboardingEvent } from "@/lib/onboarding-events";

export async function recordOnboardingEvent(input: OnboardingEvent, userId?: string) {
  if (process.env.ONBOARDING_METRICS_ENABLED !== "1") return;
  const parsed = onboardingEventSchema.safeParse(input);
  if (!parsed.success) return;
  const data = parsed.data;
  const id = createHash("sha256").update(JSON.stringify([userId ?? "anonymous", data.event === "first_real_autofill_succeeded" && userId ? "first-in-retention-window" : data.run ?? data.journey, data.event])).digest("hex");
  try {
    await prisma.onboardingEvent.upsert({ where: { id }, update: {}, create: {
      id, userId, journey: data.journey, event: data.event, entry: data.entry,
      filled: data.filled, remaining: data.remaining,
    } });
    await prisma.onboardingEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
  } catch { /* Missing migration or analytics outage must not block setup. */ }
}
