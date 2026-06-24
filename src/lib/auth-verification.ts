import { createEmailVerificationToken } from "better-auth/api";

import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email";

const APP_NAME = process.env.APP_NAME?.trim() || "ApplyOverflow";
const LOCAL_DEV_AUTH_SECRET = "autoapplication-local-dev-auth-secret-2026";
const VERIFICATION_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;
export const DEFAULT_VERIFICATION_CALLBACK_URL = "/sign-in?verified=true";

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

function getVerificationEmailLogoUrl(verificationUrl: string) {
  try {
    const logoUrl = new URL("/brand/applyoverflow-logo.png", verificationUrl);
    if (logoUrl.protocol === "http:" || logoUrl.protocol === "https:") {
      return logoUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeVerificationCallbackURL(callbackURL?: string | null) {
  const value = String(callbackURL ?? DEFAULT_VERIFICATION_CALLBACK_URL).trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_VERIFICATION_CALLBACK_URL;
  }

  if (value === "/" || value === "/?verified=true") {
    return DEFAULT_VERIFICATION_CALLBACK_URL;
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
  const logoUrl = getVerificationEmailLogoUrl(input.url);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;
  const safeAppName = escapeHtml(APP_NAME);
  const greeting = input.user.name ? `Hello ${input.user.name},` : "Hello,";
  const safeGreeting = escapeHtml(greeting);
  const text = [
    greeting,
    "",
    `Confirm your ${APP_NAME} email address to finish setting up your account.`,
    "",
    input.url,
    "",
    "This verification link expires in 1 hour.",
    "If you did not request this email, you can safely ignore it.",
    "",
    APP_NAME,
  ].join("\n");
  const html = `
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;">
      Confirm your ${safeAppName} email address. This link expires in 1 hour.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#171717;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e8eb;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 12px 32px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    ${
                      safeLogoUrl
                        ? `<td style="padding:0 10px 0 0;vertical-align:middle;">
                            <img src="${safeLogoUrl}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border:0;border-radius:7px;">
                          </td>`
                        : ""
                    }
                    <td style="vertical-align:middle;font-size:15px;font-weight:700;letter-spacing:0.02em;color:#111827;">${safeAppName}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#111827;">Verify your email address</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 0 32px;font-size:15px;line-height:1.6;color:#4b5563;">
                <p style="margin:0 0 12px 0;">${safeGreeting}</p>
                <p style="margin:0;">Confirm this email address to finish setting up your ${safeAppName} account.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <a href="${safeUrl}" style="display:inline-block;background:#0a84ff;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 18px;border-radius:10px;">Verify email</a>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 32px 0 32px;font-size:13px;line-height:1.6;color:#6b7280;">
                <p style="margin:0;">This link expires in 1 hour. If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:10px 0 0 0;word-break:break-all;color:#374151;">${safeUrl}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 30px 32px;font-size:13px;line-height:1.6;color:#6b7280;border-top:1px solid #eef0f3;">
                If you did not request this email, you can safely ignore it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  try {
    const sent = await sendEmail({
      to: input.user.email,
      subject: `Verify your ${APP_NAME} email`,
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
  url.searchParams.set("callbackURL", normalizeVerificationCallbackURL(input.callbackURL));

  return deliverVerificationEmail({
    user: input.user,
    url: url.toString(),
  });
}
