import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";

import { deliverVerificationEmail } from "@/lib/auth-verification";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { buildRuntimeTrustedOrigins } from "@/lib/runtime-origin";
import { deleteFile } from "@/lib/storage";
import { syncProfileForAuthUser } from "@/lib/user-profile-sync";

const APP_NAME = process.env.APP_NAME?.trim() || "ApplyOverflow";

function firstConfiguredUrl(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean);
}

const authSecret =
  process.env.BETTER_AUTH_SECRET ??
  (process.env.NODE_ENV !== "production"
    ? "autoapplication-local-dev-auth-secret-2026"
    : undefined);

const authBaseUrl =
  firstConfiguredUrl(
    process.env.BETTER_AUTH_URL,
    process.env.APP_URL,
    process.env.HETZNER_APP_URL,
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL
  ) ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined);

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const allowInsecureAuthCookies = ["1", "true", "yes"].includes(
  (process.env.AUTH_ALLOW_INSECURE_COOKIES ?? "").trim().toLowerCase()
);
const useSecureAuthCookies =
  process.env.NODE_ENV === "production" && !allowInsecureAuthCookies;

if (process.env.NODE_ENV === "production" && allowInsecureAuthCookies) {
  console.warn(
    "[auth] Secure auth cookies are disabled by AUTH_ALLOW_INSECURE_COOKIES. Use only for temporary HTTP/IP deployments."
  );
}

export function isGoogleAuthEnabled() {
  return Boolean(googleClientId && googleClientSecret);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const auth = betterAuth({
  appName: APP_NAME,
  secret: authSecret,
  baseURL: authBaseUrl,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await syncProfileForAuthUser(user);
        },
      },
      update: {
        after: async (user) => {
          await syncProfileForAuthUser(user);
        },
      },
      delete: {
        before: async (user) => {
          const profile = await prisma.userProfile.findUnique({
            where: { authUserId: user.id },
            select: {
              id: true,
              documents: {
                select: { storageKey: true },
              },
            },
          });

          if (profile) {
            await Promise.allSettled(profile.documents.map((doc) => deleteFile(doc.storageKey)));
          }

          return true;
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });

          return user?.status === "ACTIVE";
        },
        after: async (session) => {
          await prisma.user
            .update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
            })
            .catch((error) => {
              console.error("[auth] Failed to update last login time:", error);
            });
        },
      },
    },
  },
  user: {
    additionalFields: {
      emailNotificationsEnabled: {
        type: "boolean",
        required: false,
        defaultValue: true,
      },
      status: {
        type: "string",
        required: false,
        input: false,
        returned: false,
        defaultValue: "ACTIVE",
      },
      lastLoginAt: {
        type: "date",
        required: false,
        input: false,
        returned: false,
      },
    },
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: false,
      async sendChangeEmailConfirmation({ user, newEmail, url }) {
        const safeUrl = escapeHtml(url);
        const safeNewEmail = escapeHtml(newEmail);
        const text = `Confirm your ${APP_NAME} email change from ${user.email} to ${newEmail} by opening this link:\n\n${url}`;
        const html = `
          <p>Hello${user.name ? ` ${escapeHtml(user.name)}` : ""},</p>
          <p>Confirm changing your ${APP_NAME} account email to ${safeNewEmail}.</p>
          <p><a href="${safeUrl}">Confirm email change</a></p>
          <p style="word-break:break-all;font-size:12px;color:#888;">
            Or copy this link: ${safeUrl}
          </p>
          <p>If you did not request this, change your password and contact support.</p>
        `;

        const sent = await sendEmail({
          to: user.email,
          subject: "Confirm your email change",
          text,
          html,
        });

        if (!sent) {
          console.log(`[auth] Email change confirmation link for ${user.email}: ${url}`);
        }
      },
    },
    deleteUser: {
      enabled: true,
    },
  },
  emailVerification: {
    sendOnSignUp: false,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60,
    async sendVerificationEmail({ user, url }) {
      const result = await deliverVerificationEmail({ user, url });

      if (!result.ok) {
        console.error(
          `[auth] Verification email for ${user.email} was not delivered: ${result.reason}`
        );
      }
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,
    resetPasswordTokenExpiresIn: 60 * 30,
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders: isGoogleAuthEnabled()
    ? {
        google: {
          clientId: googleClientId!,
          clientSecret: googleClientSecret!,
        },
      }
    : undefined,
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
      updateUserInfoOnLink: true,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-in/social": { window: 60, max: 12 },
      "/sign-up/email": { window: 60 * 15, max: 5 },
      "/send-verification-email": { window: 60 * 15, max: 5 },
      "/reset-password": { window: 60 * 15, max: 8 },
      "/change-email": { window: 60 * 15, max: 4 },
      "/callback/google": { window: 60, max: 20 },
    },
  },
  advanced: {
    useSecureCookies: useSecureAuthCookies,
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"],
    },
  },
  trustedOrigins: async (request) => buildRuntimeTrustedOrigins(request?.headers),
});
