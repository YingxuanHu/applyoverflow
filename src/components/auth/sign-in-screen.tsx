"use client";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { isExtensionSetupPath } from "@/lib/profile-setup";

type SignInScreenProps = {
  callbackUrl?: string;
  defaultEmail?: string;
  emailVerificationError?: string;
  googleError?: string;
  justVerified?: boolean;
  passwordReset?: boolean;
  googleEnabled?: boolean;
  localDevelopmentAccount?: boolean;
  mobileMode?: "landing" | "form";
  reauthenticate?: boolean;
};

export function SignInScreen({
  callbackUrl = "/jobs",
  defaultEmail = "",
  emailVerificationError,
  googleError,
  justVerified = false,
  passwordReset = false,
  googleEnabled = false,
  localDevelopmentAccount = false,
  mobileMode = "form",
  reauthenticate = false,
}: SignInScreenProps) {
  const extension = isExtensionSetupPath(callbackUrl);
  return (
    <AuthShell
      contextTitle={
        extension ? "Use your profile with the Chrome extension" : <>
          Higher Quality Jobs
          <br />
          Fresher Leads
          <br />
          Fewer Loose Ends
        </>
      }
      contextDescription={extension ? "Sign in to prepare your details, then connect this browser. Your employer application stays open." : "A cleaner feed, fresher openings, and personalized help from first look to final follow-up."}
      mobileMode={mobileMode}
    >
      <SignInForm
        reauthenticate={reauthenticate}
        callbackUrl={callbackUrl}
        defaultEmail={defaultEmail}
        emailVerificationError={emailVerificationError}
        googleError={googleError}
        googleEnabled={googleEnabled}
        justVerified={justVerified}
        localDevelopmentAccount={localDevelopmentAccount}
        passwordReset={passwordReset}
      />
    </AuthShell>
  );
}
