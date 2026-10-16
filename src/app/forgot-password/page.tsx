import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getSafeSignInCallback } from "@/lib/auth-return-path";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ email?: string; callbackUrl?: string }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const sessionUser = await getOptionalSessionUser();
  const params = await searchParams;
  const callbackUrl = getSafeSignInCallback(params.callbackUrl);

  if (sessionUser) {
    redirect(callbackUrl);
  }


  return (
    <AuthShell
      contextTitle="Recover access without starting over."
      contextDescription="Reset your password and return to the same job feed, application tracker, documents, reminders, and profile data."
    >
      <ForgotPasswordForm defaultEmail={params.email ?? ""} callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
