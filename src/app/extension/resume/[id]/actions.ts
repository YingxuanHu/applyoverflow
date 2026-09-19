"use server";

import { redirect } from "next/navigation";
import {
  requireFreshSensitiveSession,
  ReauthenticationRequiredError,
  UnauthorizedError,
} from "@/lib/current-user";
import { consumeUserRateLimit } from "@/lib/api-rate-limit";
import { AssistantError } from "@/lib/queries/application-assistant";
import { approveExtensionResume } from "@/lib/queries/extension-resume";

export async function shareResume(
  _previous: { error: string },
  form: FormData,
) {
  let callback: string;
  try {
    const identity = await requireFreshSensitiveSession();
    if (
      !consumeUserRateLimit(identity.authUserId, "extension:resume-approve", {
        limit: 10,
        windowMs: 60_000,
      }).allowed
    )
      return { error: "Too many requests. Try again in a minute." };
    callback = await approveExtensionResume(identity, {
      id: form.get("id"),
      documentId: form.get("documentId"),
    });
  } catch (error) {
    if (
      error instanceof ReauthenticationRequiredError ||
      error instanceof UnauthorizedError
    )
      return {
        error:
          "Sign in again and reconnect the extension before sharing a resume.",
      };
    return {
      error:
        error instanceof AssistantError
          ? error.message
          : "Could not share this resume. Start again from the extension.",
    };
  }
  redirect(callback);
}
