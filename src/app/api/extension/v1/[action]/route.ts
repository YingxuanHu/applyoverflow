import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBodyWithLimit } from "@/lib/api-utils";
import {
  consumeUserRateLimit,
  enforceApiRateLimit,
} from "@/lib/api-rate-limit";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  exchangeExtensionResume,
  requestExtensionResume,
  getDefaultExtensionResume,
} from "@/lib/queries/extension-resume";
import {
  AssistantError,
  authenticateExtension,
  captureApplicationQuestions,
  exchangeExtensionCode,
  getExtensionContact,
  getExtensionHistory,
  confirmExtensionApplication,
} from "@/lib/queries/application-assistant";
import { revalidateTrackerOverviewViews } from "@/lib/revalidation";
import { getAutofillPlan, rememberAutofillAnswer } from "@/lib/queries/extension-autofill";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (
      ![
        "token",
        "contact",
        "history",
        "history-entry",
        "applied",
        "capture",
        "disconnect",
        "resume-request",
        "resume",
        "resume-cancel",
        "resume-default",
        "autofill-plan",
        "autofill-answer",
      ].includes(action)
    )
      return json({ error: "Not found" }, 404);
    const limited = await enforceApiRateLimit(request, "extension", {
      limit: 60,
      windowMs: 60_000,
      scope: "ip",
    });
    if (limited) return limited;
    const body = await parseJsonBodyWithLimit(request, 24_000);
    if (!body.ok) return body.response;
    if (action === "token") return json(await exchangeExtensionCode(body.data));
    const identity = await authenticateExtension(request);
    if (
      !consumeUserRateLimit(identity.userId, "extension", {
        limit: 60,
        windowMs: 60_000,
      }).allowed
    )
      return json({ error: "Too many requests. Try again shortly." }, 429);
    if (action === "contact")
      return json(await getExtensionContact(identity.userId));
    if (action === "autofill-plan")
      return json(await getAutofillPlan(identity.userId, body.data));
    if (action === "autofill-answer")
      return json(await rememberAutofillAnswer(identity.userId, body.data));
    if (action === "history")
      return json(await getExtensionHistory(identity.userId));
    if (action === "history-entry")
      return json(await getExtensionHistory(identity.userId, body.data));
    if (action === "applied") {
      const result = await confirmExtensionApplication(
        identity.userId,
        body.data,
      );
      revalidateTrackerOverviewViews();
      return json(result);
    }
    if (action.startsWith("resume")) {
      if (
        !consumeUserRateLimit(identity.userId, "extension:resume", {
          limit: 20,
          windowMs: 60_000,
        }).allowed
      )
        return json(
          { error: "Too many resume requests. Try again shortly." },
          429,
        );
      if (action === "resume-request")
        return json(await requestExtensionResume(identity, body.data));
      if (action === "resume-default")
        return json(await getDefaultExtensionResume(identity, body.data));
      if (action === "resume")
        return json(await exchangeExtensionResume(identity, body.data));
      const { id } = z
        .object({ id: z.string().cuid() })
        .strict()
        .parse(body.data);
      await prisma.extensionResumeTransfer.deleteMany({
        where: { id, connectionId: identity.connectionId },
      });
      return json({ cancelled: true });
    }
    if (action === "capture")
      return json(
        await captureApplicationQuestions(identity.userId, body.data),
      );
    await prisma.extensionConnection.deleteMany({
      where: { id: identity.connectionId, userId: identity.userId },
    });
    return json({ disconnected: true });
  } catch (error) {
    if (error instanceof AssistantError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json({ error: "Invalid extension request." }, 400);
    // Never log tokens, questions, answers, or profile contents.
    console.error(
      "[extension] Request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json({ error: "Could not complete this request. Try again." }, 500);
  }
}
