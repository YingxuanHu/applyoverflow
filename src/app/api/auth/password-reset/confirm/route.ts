import { NextResponse } from "next/server";

import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
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

  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    newPassword?: unknown;
  } | null;

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
