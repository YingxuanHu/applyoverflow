import { createHmac, randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { resolveCanonicalAppUrl } from "@/lib/runtime-origin";

const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const LOCAL_DEV_AUTH_SECRET = "autoapplication-local-dev-auth-secret-2026";

export const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account exists for this email, we sent reset instructions.";

function getAuthTokenSecret() {
  const secret =
    process.env.BETTER_AUTH_SECRET ??
    (process.env.NODE_ENV !== "production" ? LOCAL_DEV_AUTH_SECRET : undefined);

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required for password reset tokens.");
  }

  return secret;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashAuthToken(token: string) {
  return createHmac("sha256", getAuthTokenSecret()).update(token).digest("hex");
}

async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  url: string;
}) {
  const appName = process.env.APP_NAME?.trim() || "ApplyOverflow";
  const safeUrl = escapeHtml(input.url);
  const text = `Reset your ${appName} password by opening this link:\n\n${input.url}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`;
  const html = `
    <p>Hello${input.name ? ` ${escapeHtml(input.name)}` : ""},</p>
    <p>Reset your ${appName} password. This link expires in 30 minutes.</p>
    <p><a href="${safeUrl}">Reset password</a></p>
    <p style="word-break:break-all;font-size:12px;color:#888;">
      Or copy this link: ${safeUrl}
    </p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  const sent = await sendEmail({
    to: input.email,
    subject: "Reset your password",
    text,
    html,
  });

  if (!sent) {
    console.log(`[auth] Password reset link for ${input.email}: ${input.url}`);
  }
}

async function sendPasswordChangedEmail(input: { email: string; name: string }) {
  const appName = process.env.APP_NAME?.trim() || "ApplyOverflow";
  const text = `Your ${appName} password was changed. If you did not make this change, reset your password immediately.`;
  const html = `
    <p>Hello${input.name ? ` ${escapeHtml(input.name)}` : ""},</p>
    <p>Your ${appName} password was changed.</p>
    <p>If you did not make this change, reset your password immediately.</p>
  `;

  await sendEmail({
    to: input.email,
    subject: "Your password was changed",
    text,
    html,
  });
}

export async function requestPasswordResetEmail(emailInput: string, _request?: Request) {
  const email = normalizeEmail(emailInput);
  if (!email) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
    },
  });

  if (!user || user.status !== "ACTIVE") {
    return;
  }

  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const resetUrl = new URL("/reset-password", resolveCanonicalAppUrl());
  resetUrl.searchParams.set("token", token);

  await prisma.$transaction(async (tx) => {
    await tx.authSecurityToken.updateMany({
      where: {
        userId: user.id,
        type: "PASSWORD_RESET",
        usedAt: null,
      },
      data: { usedAt: now },
    });

    await tx.authSecurityToken.create({
      data: {
        userId: user.id,
        tokenHash: hashAuthToken(token),
        type: "PASSWORD_RESET",
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });
  });

  await sendPasswordResetEmail({
    email: user.email,
    name: user.name,
    url: resetUrl.toString(),
  });
}

export async function resetPasswordWithToken(input: {
  token: string;
  newPassword: string;
}) {
  const token = input.token.trim();
  const newPassword = input.newPassword;

  if (!token || newPassword.length < 8 || newPassword.length > 128) {
    return { ok: false as const, reason: "invalid" as const };
  }

  const tokenHash = hashAuthToken(token);
  const record = await prisma.authSecurityToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
        },
      },
    },
  });

  if (
    !record ||
    record.type !== "PASSWORD_RESET" ||
    record.usedAt ||
    record.expiresAt <= new Date() ||
    record.user.status !== "ACTIVE"
  ) {
    return { ok: false as const, reason: "invalid" as const };
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const tokenUpdate = await tx.authSecurityToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (tokenUpdate.count !== 1) {
      return false;
    }

    const credentialAccount = await tx.account.findFirst({
      where: {
        userId: record.userId,
        providerId: "credential",
      },
      select: { id: true },
    });

    if (credentialAccount) {
      await tx.account.update({
        where: { id: credentialAccount.id },
        data: { password: passwordHash },
      });
    } else {
      await tx.account.create({
        data: {
          userId: record.userId,
          providerId: "credential",
          accountId: record.userId,
          password: passwordHash,
        },
      });
    }

    await tx.session.deleteMany({
      where: { userId: record.userId },
    });

    return true;
  });

  if (!updated) {
    return { ok: false as const, reason: "invalid" as const };
  }

  await sendPasswordChangedEmail({
    email: record.user.email,
    name: record.user.name,
  });

  return { ok: true as const };
}
