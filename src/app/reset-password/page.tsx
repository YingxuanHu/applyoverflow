import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      contextTitle="Set a new password and continue."
      contextDescription="After the update, sign in again and return to the workspace that holds your jobs, documents, answers, and application history."
    >
      <ResetPasswordForm errorCode={params.error} token={params.token} />
    </AuthShell>
  );
}
