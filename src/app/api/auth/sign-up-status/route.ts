import { NextResponse } from "next/server";

import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { normalizeAuthEmail } from "@/lib/auth-verification";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const rateLimit = consumeAuthRateLimit(request, "sign-up-status", {
    limit: 30,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const email = normalizeAuthEmail(searchParams.get("email") ?? "");

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      emailVerified: true,
      status: true,
    },
  });

  return NextResponse.json(
    {
      exists: Boolean(user),
      emailVerified: user?.emailVerified ?? false,
      disabled: user ? user.status !== "ACTIVE" : false,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
