"use client";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

type SignInScreenProps = {
  callbackUrl?: string;
  defaultEmail?: string;
  googleError?: string;
  justVerified?: boolean;
  googleEnabled?: boolean;
};

export function SignInScreen({
  callbackUrl = "/jobs",
  defaultEmail = "",
  googleError,
  justVerified = false,
  googleEnabled = false,
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
    >
      <SignInForm
        callbackUrl={callbackUrl}
        defaultEmail={defaultEmail}
        googleError={googleError}
        googleEnabled={googleEnabled}
        justVerified={justVerified}
      />
    </AuthShell>
  );
}
