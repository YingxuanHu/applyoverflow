import { createEmailVerificationToken } from "better-auth/api";

import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email";

const APP_NAME = process.env.APP_NAME?.trim() || "ApplyOverflow";
const LOCAL_DEV_AUTH_SECRET = "autoapplication-local-dev-auth-secret-2026";
const VERIFICATION_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

type VerificationEmailUser = {
  email: string;
  name?: string | null;
};

export type VerificationEmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "send_failed" };

export function normalizeAuthEmail(email: string) {
  return email.trim().toLowerCase();
}

function getAuthTokenSecret() {
  const secret =
    process.env.BETTER_AUTH_SECRET ??
    (process.env.NODE_ENV !== "production" ? LOCAL_DEV_AUTH_SECRET : undefined);

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required for verification emails.");
  }

  return secret;
}

function getRequestOrigin(request?: Request) {
  const forwardedHost = request?.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request?.headers.get("host");

  if (host) {
    const forwardedProto =
      request?.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${forwardedProto}://${host}`;
  }

  return (
    process.env.BETTER_AUTH_URL ??
    process.env.APP_URL ??
    process.env.HETZNER_APP_URL ??
    "http://localhost:3000"
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeCallbackURL(callbackURL?: string | null) {
  const value = String(callbackURL ?? "/?verified=true").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/?verified=true";
  }

  return value;
}

export async function deliverVerificationEmail(input: {
  user: VerificationEmailUser;
  url: string;
}): Promise<VerificationEmailResult> {
  if (!isEmailDeliveryConfigured()) {
    console.error("[auth] Verification email was not sent because SMTP is not configured.");
    console.log(`[auth] Verification email link for ${input.user.email}: ${input.url}`);
    return { ok: false, reason: "not_configured" };
  }

  const safeUrl = escapeHtml(input.url);
  const text = `Verify your ${APP_NAME} email by opening this link:\n\n${input.url}`;
  const html = `
    <p>Hello${input.user.name ? ` ${escapeHtml(input.user.name)}` : ""},</p>
    <p>Verify your ${APP_NAME} email address.</p>
    <p><a href="${safeUrl}">Verify email</a></p>
    <p style="word-break:break-all;font-size:12px;color:#888;">
      Or copy this link: ${safeUrl}
    </p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  try {
    const sent = await sendEmail({
      to: input.user.email,
      subject: "Verify your email",
      text,
      html,
    });

    return sent ? { ok: true } : { ok: false, reason: "send_failed" };
  } catch (error) {
    console.error("[auth] Failed to send verification email:", error);
    return { ok: false, reason: "send_failed" };
  }
}

export async function sendVerificationEmailForUser(input: {
  user: VerificationEmailUser;
  callbackURL?: string | null;
  request?: Request;
}) {
  const token = await createEmailVerificationToken(
    getAuthTokenSecret(),
    normalizeAuthEmail(input.user.email),
    undefined,
    VERIFICATION_TOKEN_EXPIRES_IN_SECONDS
  );
  const url = new URL("/verify-email", getRequestOrigin(input.request));
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", normalizeCallbackURL(input.callbackURL));

  return deliverVerificationEmail({
    user: input.user,
    url: url.toString(),
  });
}
