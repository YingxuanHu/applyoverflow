import { NextResponse } from "next/server";

import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import {
  API_BODY_LIMITS,
  parseJsonBodyWithLimit,
} from "@/lib/api-utils";
import {
  normalizeAuthEmail,
  normalizeVerificationCallbackURL,
  sendVerificationEmailForUser,
} from "@/lib/auth-verification";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const rateLimit = consumeAuthRateLimit(request, "resend-verification", {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        status: "rate_limited",
        message: "Too many verification email requests. Try again shortly.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const parsedBody = await parseJsonBodyWithLimit<Record<string, unknown>>(
    request,
    API_BODY_LIMITS.authJson,
    "Verification email request"
  );
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const body = parsedBody.data;
  const email = normalizeAuthEmail(String(body?.email ?? ""));

  if (!email) {
    return NextResponse.json(
      { status: "invalid_email", message: "Enter a valid email address." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      email: true,
      emailVerified: true,
      name: true,
      status: true,
    },
  });

  if (!user) {
    return NextResponse.json(
      {
        status: "not_found",
        message: "No account exists for this email. Create an account first.",
      },
      { status: 404 }
    );
  }

  if (user.status !== "ACTIVE") {
    return NextResponse.json(
      {
        status: "unavailable",
        message: "This account cannot receive verification email right now.",
      },
      { status: 403 }
    );
  }

  if (user.emailVerified) {
    return NextResponse.json({
      status: "already_verified",
      message: "This email is already verified. Sign in instead.",
    });
  }

  const result = await sendVerificationEmailForUser({
    user,
    callbackURL: normalizeVerificationCallbackURL(String(body?.callbackURL ?? "")),
    request,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        status: "delivery_failed",
        message: "We could not send verification email right now. Try again later.",
      },
      { status: result.reason === "not_configured" ? 503 : 502 }
    );
  }

  return NextResponse.json({
    status: "sent",
    message: "Verification email sent. Check your inbox and spam folder.",
  });
}
