"use client";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

type SignInScreenProps = {
  callbackUrl?: string;
  defaultEmail?: string;
  emailVerificationError?: string;
  googleError?: string;
  justVerified?: boolean;
  googleEnabled?: boolean;
  mobileMode?: "landing" | "form";
};

export function SignInScreen({
  callbackUrl = "/jobs",
  defaultEmail = "",
  emailVerificationError,
  googleError,
  justVerified = false,
  googleEnabled = false,
  mobileMode = "form",
}: SignInScreenProps) {
  return (
    <AuthShell
      contextTitle={
        <>
          Higher Quality Jobs
          <br />
          Fresher Leads
          <br />
          Fewer Loose Ends
        </>
      }
      contextDescription="A cleaner feed, fresher openings, and personalized help from first look to final follow-up."
      mobileMode={mobileMode}
    >
      <SignInForm
        callbackUrl={callbackUrl}
        defaultEmail={defaultEmail}
        emailVerificationError={emailVerificationError}
        googleError={googleError}
        googleEnabled={googleEnabled}
        justVerified={justVerified}
      />
    </AuthShell>
  );
}
