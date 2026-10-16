import { z } from "zod";
import { requireCurrentWebSession, UnauthorizedError } from "@/lib/current-user";
import { parseJsonBodyWithLimit } from "@/lib/api-utils";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { createSetupChallenge, readSetupChallenge, extensionSetupCapabilities } from "@/lib/queries/extension-setup";
import { AssistantError } from "@/lib/queries/application-assistant";
import { recordOnboardingEvent } from "@/lib/queries/onboarding-events";
import { buildRuntimeTrustedOrigins } from "@/lib/runtime-origin";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    if (!buildRuntimeTrustedOrigins().some(value => new URL(value).origin === request.headers.get("origin"))) return json({ error: "Open setup in ApplyOverflow." }, 403);
    const limited = await enforceApiRateLimit(request, "extension-setup", { limit: 30, windowMs: 60_000, scope: "ip" });
    if (limited) return limited;
    const identity = await requireCurrentWebSession();
    const body = await parseJsonBodyWithLimit(request, 1000);
    if (!body.ok) return body.response;
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("challenge"), clientId: z.string().regex(/^[a-p]{32}$/), accountId: z.string(), journey: z.string().uuid().optional() }).strict(),
      z.object({ action: z.literal("result"), challenge: z.string().max(100), accountId: z.string(), journey: z.string().uuid().optional() }).strict(),
    ]).parse(body.data);
    if (input.accountId !== identity.authUserId) return json({ error: "Your signed-in account changed. Reload setup before continuing." }, 409);
    if (input.action === "challenge") return json(await createSetupChallenge(identity, input.clientId));
    const result = await readSetupChallenge(identity, input.challenge);
    if (result.state === "verified" && input.journey) await recordOnboardingEvent({ event: "extension_connection_completed", entry: "extension", journey: input.journey }, identity.authUserId);
    return json({ ...result, capabilities: await extensionSetupCapabilities(identity.authUserId) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return json({ error: "Your session expired. Sign in to continue setup." }, 401);
    if (error instanceof AssistantError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "Update the extension and check again." }, 400);
    return json({ error: "Could not verify this connection. Retry shortly." }, 503);
  }
}
