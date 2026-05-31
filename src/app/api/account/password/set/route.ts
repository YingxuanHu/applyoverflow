import { NextResponse } from "next/server";
import { hashPassword } from "better-auth/crypto";

import { auth } from "@/lib/auth";
import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { prisma } from "@/lib/db";

const FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const rateLimit = consumeAuthRateLimit(request, "set-password", {
    limit: 6,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });

  if (user?.status !== "ACTIVE") {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (Date.now() - new Date(session.session.createdAt).getTime() > FRESH_SESSION_MS) {
    return NextResponse.json(
      { error: "Sign in again before adding a password." },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as { newPassword?: unknown } | null;
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json(
      { error: "Use a password between 8 and 128 characters." },
      { status: 400 }
    );
  }

  const existingCredential = await prisma.account.findFirst({
    where: {
      userId: session.user.id,
      providerId: "credential",
    },
    select: { id: true },
  });

  if (existingCredential) {
    return NextResponse.json(
      { error: "This account already has a password." },
      { status: 409 }
    );
  }

  await prisma.account.create({
    data: {
      userId: session.user.id,
      providerId: "credential",
      accountId: session.user.id,
      password: await hashPassword(newPassword),
    },
  });

  return NextResponse.json({ message: "Password added." });
}
