import { NextResponse } from "next/server";

import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import {
  API_BODY_LIMITS,
  parseJsonBodyWithLimit,
} from "@/lib/api-utils";
import { resetPasswordWithToken } from "@/lib/auth-password-reset";

export async function POST(request: Request) {
  const rateLimit = consumeAuthRateLimit(request, "password-reset-confirm", {
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many reset attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const parsedBody = await parseJsonBodyWithLimit<{
    token?: unknown;
    newPassword?: unknown;
  }>(request, API_BODY_LIMITS.authJson, "Password reset confirmation");
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const body = parsedBody.data;

  const token = typeof body?.token === "string" ? body.token : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  const result = await resetPasswordWithToken({ token, newPassword });

  if (!result.ok) {
    return NextResponse.json(
      { error: "This reset link is invalid or expired. Request a new one." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    message: "Password reset successful. Sign in with your new password.",
  });
}
