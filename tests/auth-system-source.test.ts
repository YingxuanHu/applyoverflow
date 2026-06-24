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
  const verifyEmailPage = readRepoFile("src/app/verify-email/page.tsx");
  const verificationMailer = readRepoFile("src/lib/auth-verification.ts");

  assert.match(signInPage, /email\?: string/);
  assert.match(signInPage, /verified\?: string/);
  assert.match(signInForm, /defaultEmail/);
  assert.match(signInForm, /Email verified\. You can now sign in/);
  assert.match(verifyCard, /already verified\. Sign in instead/);
  assert.match(verifyCard, /\/sign-in\?verified=true/);
  assert.match(verifyCard, /\/api\/auth\/resend-verification/);
  assert.match(verifyEmailPage, /\/api\/auth\/verify-email/);
  assert.match(verificationMailer, /DEFAULT_VERIFICATION_CALLBACK_URL = "\/sign-in\?verified=true"/);
  assert.match(verificationMailer, /value === "\/" \|\| value === "\/\?verified=true"/);
  assert.match(verificationMailer, /getVerificationEmailLogoUrl/);
  assert.match(verificationMailer, /\/brand\/applyoverflow-logo\.png/);
  assert.match(verificationMailer, /<img src="\$\{safeLogoUrl\}"/);
});

test("auth config keeps Google separate from email/password accounts", () => {
  const authSource = readRepoFile("src/lib/auth.ts");
  const proxySource = readRepoFile("src/proxy.ts");
  const currentUserSource = readRepoFile("src/lib/current-user.ts");

  assert.match(authSource, /GOOGLE_CLIENT_ID/);
  assert.match(authSource, /socialProviders/);
  assert.match(authSource, /accountLinking:\s*{/);
  assert.match(authSource, /enabled:\s*false/);
  assert.match(authSource, /disableImplicitLinking:\s*true/);
  assert.doesNotMatch(authSource, /trustedProviders:\s*\["google"\]/);
  assert.match(authSource, /revokeSessionsOnPasswordReset:\s*true/);
  assert.match(authSource, /expiresIn:\s*SESSION_MAX_LIFETIME_SECONDS/);
  assert.match(authSource, /updateAge:\s*SESSION_REFRESH_INTERVAL_SECONDS/);
  assert.match(authSource, /freshAge:\s*SENSITIVE_ACTION_REAUTH_SECONDS/);
  assert.match(authSource, /rateLimit:\s*{/);
  assert.match(authSource, /sendOnSignUp:\s*false/);
  assert.match(authSource, /sendChangeEmailConfirmation/);
  assert.match(authSource, /lastLoginAt/);
  assert.match(proxySource, /session\.user\.status === "ACTIVE"/);
  assert.match(proxySource, /isSessionUsableByPolicy/);
  assert.match(currentUserSource, /requireFreshSensitiveSession/);
  assert.match(currentUserSource, /ReauthenticationRequiredError/);
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

test("settings expose security controls without account linking", () => {
  const settingsPage = readRepoFile("src/app/settings/page.tsx");
  const securityPanel = readRepoFile("src/components/auth/account-security-panel.tsx");
  const googleButton = readRepoFile("src/components/auth/google-auth-button.tsx");

  assert.match(settingsPage, /id="security"/);
  assert.match(settingsPage, /<AccountSecurityPanel/);
  assert.doesNotMatch(googleButton, /linkSocial/);
  assert.doesNotMatch(securityPanel, /unlinkAccount/);
  assert.doesNotMatch(securityPanel, /Connected accounts/);
  assert.match(securityPanel, /Sign-in method/);
  assert.match(securityPanel, /changePassword/);
  assert.match(securityPanel, /changeEmail/);
  assert.match(securityPanel, /revokeOtherSessions/);
  assert.match(securityPanel, /revokeSessions/);
});

test("sensitive data endpoints require a fresh session; application deletion remains owner-scoped", () => {
  const exportRoute = readRepoFile("src/app/api/settings/export/route.ts");
  const profileActions = readRepoFile("src/app/profile/actions.ts");
  const applicationDeleteRoute = readRepoFile("src/app/api/applications/[id]/route.ts");
  const trackerQueries = readRepoFile("src/lib/queries/tracker.ts");

  assert.match(exportRoute, /requireFreshSensitiveSession/);
  assert.match(exportRoute, /ReauthenticationRequiredError/);
  assert.match(profileActions, /requireFreshSessionForDestructiveProfileAction/);
  assert.match(profileActions, /deleteProfileResume/);
  assert.match(profileActions, /deleteProfileCoverLetter/);
  assert.match(profileActions, /deleteTemplate/);
  assert.doesNotMatch(applicationDeleteRoute, /requireFreshSensitiveSession/);
  assert.doesNotMatch(applicationDeleteRoute, /ReauthenticationRequiredError/);
  assert.match(applicationDeleteRoute, /deleteTrackedApplication/);
  assert.match(trackerQueries, /export async function deleteTrackedApplication/);
  assert.match(trackerQueries, /requireCurrentAuthUserId/);
  assert.match(trackerQueries, /requireCurrentProfileId/);
  assert.match(trackerQueries, /userId: authUserId/);
});
