import { getOptionalSessionUser } from "@/lib/current-user";
import { parseJsonBodyWithLimit } from "@/lib/api-utils";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { onboardingEventSchema } from "@/lib/onboarding-events";
import { recordOnboardingEvent } from "@/lib/queries/onboarding-events";
import { buildRuntimeTrustedOrigins } from "@/lib/runtime-origin";

export async function POST(request: Request) {
  const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (process.env.ONBOARDING_METRICS_ENABLED !== "1") return done();
  if (!buildRuntimeTrustedOrigins().some(value => new URL(value).origin === request.headers.get("origin"))) return new Response(null, { status: 403 });
  const limit = await enforceApiRateLimit(request, "onboarding-events", { limit: 30, windowMs: 60_000, scope: "ip" });
  if (limit) return limit;
  const body = await parseJsonBodyWithLimit(request, 600);
  if (!body.ok) return body.response;
  const parsed = onboardingEventSchema.safeParse(body.data);
  if (!parsed.success || !["setup_opened", "profile_import_attempted", "profile_import_completed", "profile_import_failed", "recovery_shown", "recovery_completed"].includes(parsed.data.event)) return new Response(null, { status: 400 });
  const user = await getOptionalSessionUser();
  await recordOnboardingEvent(parsed.data, user?.id);
  if (user && parsed.data.event === "setup_opened") await recordOnboardingEvent({ ...parsed.data, event: "authentication_completed" }, user.id);
  return done();
}
