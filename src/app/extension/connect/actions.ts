"use server";

import { redirect } from "next/navigation";
import {
  requireFreshSensitiveSession,
  ReauthenticationRequiredError,
  UnauthorizedError,
} from "@/lib/current-user";
import { consumeUserRateLimit } from "@/lib/api-rate-limit";
import {
  extensionCallback,
  extensionRequestSchema,
} from "@/lib/application-assistant";
import {
  AssistantError,
  authorizeExtension,
} from "@/lib/queries/application-assistant";

export async function approveExtension(raw: unknown) {
  const parsed = extensionRequestSchema.safeParse(raw);
  if (!parsed.success)
    return {
      error: "Invalid connection request. Start again in the extension.",
    };
  let code: string;
  try {
    const identity = await requireFreshSensitiveSession();
    if (
      !consumeUserRateLimit(identity.authUserId, "extension:authorize", {
        limit: 10,
        windowMs: 60_000,
      }).allowed
    )
      return { error: "Too many connections. Try again in a minute." };
    code = await authorizeExtension(identity, parsed.data);
  } catch (error) {
    if (
      error instanceof ReauthenticationRequiredError ||
      error instanceof UnauthorizedError
    )
      return {
        reauthenticateUrl: `/sign-in?reauthenticate=1&callbackUrl=${encodeURIComponent(`/extension/connect?${new URLSearchParams(parsed.data)}`)}`,
      };
    return {
      error:
        error instanceof AssistantError
          ? error.message
          : "Could not connect. Try again.",
    };
  }
  const callback = new URL(extensionCallback(parsed.data.clientId));
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", parsed.data.state);
  redirect(callback.href);
}
