import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getOptionalSessionUser } from "@/lib/current-user";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const sessionUser = await getOptionalSessionUser();

  if (sessionUser) {
    redirect("/jobs");
  }

  const params = await searchParams;

  return (
    <AuthShell
      contextTitle="Recover access without starting over."
      contextDescription="Reset your password and return to the same job feed, application tracker, documents, reminders, and profile data."
    >
      <ForgotPasswordForm defaultEmail={params.email ?? ""} />
    </AuthShell>
  );
}
