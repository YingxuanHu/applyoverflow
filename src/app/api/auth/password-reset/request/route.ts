import { NextResponse } from "next/server";

import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
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

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";

  await requestPasswordResetEmail(email, request).catch((error) => {
    console.error("[auth] Password reset request failed:", error);
  });

  return NextResponse.json({ message: PASSWORD_RESET_GENERIC_MESSAGE });
}
