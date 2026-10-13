import { z } from "zod";
import { NextResponse } from "next/server";
import { requireCurrentAuthUserId } from "@/lib/current-user";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { handleApiRouteError, parseJsonBodyWithLimit } from "@/lib/api-utils";
import { AssistantError } from "@/lib/queries/application-assistant";
import { createAutoApplyHandoff, getAutoApplyWorkspace, queueAutoApplyJob, removeAutoApplyJob } from "@/lib/queries/auto-apply";
import { revalidateTrackerOverviewViews } from "@/lib/revalidation";
import { buildRuntimeTrustedOrigins } from "@/lib/runtime-origin";

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  try {
    const userId = await requireCurrentAuthUserId();
    const page = z.coerce.number().int().min(1).max(100).catch(1).parse(new URL(request.url).searchParams.get("page") ?? 1);
    return json(await getAutoApplyWorkspace(userId, page));
  } catch (error) { return handleApiRouteError(error, "GET Auto Apply", "Could not load Auto Apply."); }
}
export async function POST(request: Request) {
  try {
    if (!buildRuntimeTrustedOrigins().some(value => new URL(value).origin === request.headers.get("origin"))) return json({ error: "Open Auto Apply on this site before continuing." }, 403);
    const limited = await enforceApiRateLimit(request, "auto-apply", { limit: 30, windowMs: 60_000, scope: "ip" });
    if (limited) return limited;
    const userId = await requireCurrentAuthUserId();
    const body = await parseJsonBodyWithLimit(request, 4096);
    if (!body.ok) return body.response;
    const parsed = z.object({ action: z.enum(["queue", "remove", "handoff"]), id: z.string().min(1).max(100) }).strict().safeParse(body.data);
    if (!parsed.success) return json({ error: "Invalid application request." }, 400);
    const { action, id } = parsed.data;
    const result = action === "queue" ? await queueAutoApplyJob(userId, id) : action === "remove" ? await removeAutoApplyJob(userId, id) : await createAutoApplyHandoff(userId, id);
    if (action !== "handoff") revalidateTrackerOverviewViews();
    return json(result);
  } catch (error) {
    if (error instanceof AssistantError) return json({ error: error.message }, error.status);
    return handleApiRouteError(error, "POST Auto Apply", "Could not update Auto Apply.");
  }
}
