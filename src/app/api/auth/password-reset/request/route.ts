import { NextResponse } from "next/server";

import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import {
  API_BODY_LIMITS,
  parseJsonBodyWithLimit,
} from "@/lib/api-utils";
import {
  PASSWORD_RESET_GENERIC_MESSAGE,
  requestPasswordResetEmail,
} from "@/lib/auth-password-reset";

export async function POST(request: Request) {
  const rateLimit = consumeAuthRateLimit(request, "password-reset-request", {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: PASSWORD_RESET_GENERIC_MESSAGE },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const parsedBody = await parseJsonBodyWithLimit<{ email?: unknown }>(
    request,
    API_BODY_LIMITS.authJson,
    "Password reset request"
  );
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const body = parsedBody.data;
  const email = typeof body?.email === "string" ? body.email : "";

  await requestPasswordResetEmail(email, request).catch((error) => {
    console.error("[auth] Password reset request failed:", error);
  });

  return NextResponse.json({ message: PASSWORD_RESET_GENERIC_MESSAGE });
}
