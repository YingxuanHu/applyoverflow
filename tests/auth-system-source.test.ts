import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("signup checks duplicate accounts before creating or resending verification", () => {
  const signUpForm = readRepoFile("src/components/auth/sign-up-form.tsx");
  const signUpStatusRoute = readRepoFile("src/app/api/auth/sign-up-status/route.ts");
  const resendRoute = readRepoFile("src/app/api/auth/resend-verification/route.ts");

  assert.match(signUpForm, /\/api\/auth\/sign-up-status/);
  assert.match(signUpForm, /\/api\/auth\/resend-verification/);
  assert.match(signUpForm, /This email is already registered/);
  assert.match(signUpForm, /forgot-password\?email/);
  assert.match(signUpForm, /sign-in\?email/);
  assert.match(signUpStatusRoute, /emailVerified/);
  assert.match(resendRoute, /already_verified/);
  assert.match(resendRoute, /sendVerificationEmailForUser/);
  assert.equal(
    existsSync(new URL("../src/app/api/auth/sign-up-status/route.ts", import.meta.url)),
    true
  );
});

test("auth recovery pages keep duplicate-account guidance clear", () => {
  const signInPage = readRepoFile("src/app/sign-in/page.tsx");
  const signInForm = readRepoFile("src/components/auth/sign-in-form.tsx");
  const verifyCard = readRepoFile("src/components/auth/verify-email-card.tsx");

  assert.match(signInPage, /email\?: string/);
  assert.match(signInForm, /defaultEmail/);
  assert.match(verifyCard, /already verified\. Sign in instead/);
  assert.match(verifyCard, /\/api\/auth\/resend-verification/);
});

test("auth config enables Google linking, rate limits, and safer session checks", () => {
  const authSource = readRepoFile("src/lib/auth.ts");
  const proxySource = readRepoFile("src/proxy.ts");
  const currentUserSource = readRepoFile("src/lib/current-user.ts");

  assert.match(authSource, /GOOGLE_CLIENT_ID/);
  assert.match(authSource, /socialProviders/);
  assert.match(authSource, /trustedProviders:\s*\["google"\]/);
  assert.match(authSource, /allowDifferentEmails:\s*false/);
  assert.match(authSource, /revokeSessionsOnPasswordReset:\s*true/);
  assert.match(authSource, /rateLimit:\s*{/);
  assert.match(authSource, /sendOnSignUp:\s*false/);
  assert.match(authSource, /sendChangeEmailConfirmation/);
  assert.match(authSource, /lastLoginAt/);
  assert.match(proxySource, /session\.user\.status === "ACTIVE"/);
  assert.match(currentUserSource, /user\?\.status !== "ACTIVE"/);
});

test("app password reset flow stores hashed reset tokens and revokes sessions", () => {
  const resetSource = readRepoFile("src/lib/auth-password-reset.ts");
  const forgotForm = readRepoFile("src/components/auth/forgot-password-form.tsx");
  const resetForm = readRepoFile("src/components/auth/reset-password-form.tsx");

  assert.match(resetSource, /createHmac\("sha256"/);
  assert.match(resetSource, /tokenHash/);
  assert.match(resetSource, /authSecurityToken\.create/);
  assert.match(resetSource, /session\.deleteMany/);
  assert.match(forgotForm, /\/api\/auth\/password-reset\/request/);
  assert.match(resetForm, /\/api\/auth\/password-reset\/confirm/);
  assert.doesNotMatch(forgotForm, /requestPasswordReset/);
  assert.doesNotMatch(resetForm, /authClient\.resetPassword/);
});

test("settings expose account security controls for providers and sessions", () => {
  const settingsPage = readRepoFile("src/app/settings/page.tsx");
  const securityPanel = readRepoFile("src/components/auth/account-security-panel.tsx");
  const googleButton = readRepoFile("src/components/auth/google-auth-button.tsx");

  assert.match(settingsPage, /id="security"/);
  assert.match(settingsPage, /<AccountSecurityPanel/);
  assert.match(googleButton, /linkSocial/);
  assert.match(securityPanel, /unlinkAccount/);
  assert.match(securityPanel, /changePassword/);
  assert.match(securityPanel, /changeEmail/);
  assert.match(securityPanel, /revokeOtherSessions/);
  assert.match(securityPanel, /revokeSessions/);
});
