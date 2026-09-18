import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getSafeSignInCallback } from "@/lib/auth-return-path";
import { getPostSignInDestination } from "@/lib/queries/profile-setup";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const sessionUser = await getOptionalSessionUser();
  const callbackUrl = getSafeSignInCallback((await searchParams).callbackUrl);

  if (sessionUser) {
    redirect(await getPostSignInDestination(sessionUser.id, callbackUrl));
  }

  return (
    <AuthShell
      contextTitle="Build a workspace around the jobs worth applying to."
      contextDescription="Set up once, then use better job signals, reusable documents, saved answers, and reminders across every application."
      footer={null}
    >
      <SignUpForm googleEnabled={isGoogleAuthEnabled()} callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
