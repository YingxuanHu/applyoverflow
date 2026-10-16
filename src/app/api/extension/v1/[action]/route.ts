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
  checkExtensionSubmission,
} from "@/lib/queries/application-assistant";
import { revalidateTrackerOverviewViews } from "@/lib/revalidation";
import { getAutofillPlan, rememberAutofillAnswer } from "@/lib/queries/extension-autofill";
import { suggestApplicationAnswer } from "@/lib/queries/extension-suggestions";
import { extensionValidationFields } from "@/lib/extension-errors";
import { resolveAutoApplyTarget } from "@/lib/queries/auto-apply";
import { answerSetupChallenge, extensionSetupCapabilities } from "@/lib/queries/extension-setup";
import { onboardingEventSchema } from "@/lib/onboarding-events";
import { recordOnboardingEvent } from "@/lib/queries/onboarding-events";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { action } = await params;
    if (
      ![
        "token",
        "contact",
        "connection-status",
        "setup-check",
        "onboarding-event",
        "workspace-target",
        "history",
        "history-entry",
        "applied",
        "submission-check",
        "capture",
        "disconnect",
        "resume-request",
        "resume",
        "resume-cancel",
        "resume-default",
        "autofill-plan",
        "autofill-answer",
        "autofill-suggest",
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
    if (action === "connection-status") return json({ connected: true, capabilities: await extensionSetupCapabilities(identity.userId), metricsEnabled: process.env.ONBOARDING_METRICS_ENABLED === "1" });
    if (action === "setup-check") return json(await answerSetupChallenge(identity, body.data));
    if (action === "onboarding-event") {
      const event = onboardingEventSchema.parse(body.data);
      if (!["autofill_attempted", "autofill_completed", "first_real_autofill_succeeded"].includes(event.event) || event.entry !== "extension") return json({ error: "Unsupported event" }, 400);
      await recordOnboardingEvent(event, identity.userId);
      return json({ recorded: true });
    }
    if (action === "workspace-target") return json(await resolveAutoApplyTarget(identity.userId, body.data));
    if (action === "contact")
      return json(await getExtensionContact(identity.userId));
    if (action === "submission-check")
      return json(await checkExtensionSubmission(identity.userId, body.data));
    if (action === "autofill-plan")
      return json(await getAutofillPlan(identity.userId, body.data));
    if (action === "autofill-answer")
      return json(await rememberAutofillAnswer(identity.userId, body.data));
    if (action === "autofill-suggest") {
      // A single long form can contain up to 40 bounded answer requests. The
      // shared hourly AI budget and concurrency lease still apply to every call.
      if (!consumeUserRateLimit(identity.userId, "extension:suggest", { limit: 40, windowMs: 300_000 }).allowed)
        return json({ error: "Draft limit reached. Try again in a few minutes." }, 429);
      const result = await suggestApplicationAnswer(identity.userId, body.data);
      await authenticateExtension(request);
      return json(result);
    }
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
      return json({ error: error.message, code: error.code || (error.status === 401 ? "SIGN_IN_REQUIRED" : "REQUEST_FAILED"), requestId }, error.status);
    if (error instanceof ZodError) {
      const fields = extensionValidationFields(error);
      console.warn("[extension] Request validation failed", { requestId, fields });
      return json({ error: "The extension sent unsupported form data. Update the extension and retry; signing out will not fix this error.",
        code: "EXTENSION_REQUEST_INVALID", fields, requestId }, 400);
    }
    // Never log tokens, questions, answers, or profile contents.
    console.error(
      "[extension] Request failed",
      requestId,
      error instanceof Error ? error.name : "UnknownError",
    );
    return json({ error: "ApplyOverflow is temporarily unavailable. Retry shortly; you do not need to sign out.", code: "SERVICE_UNAVAILABLE", requestId }, 500);
  }
}
