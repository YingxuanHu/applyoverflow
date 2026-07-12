import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailCard } from "@/components/auth/verify-email-card";

type VerifyEmailRequiredPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function VerifyEmailRequiredPage({
  searchParams,
}: VerifyEmailRequiredPageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      contextTitle="Confirm the email for this workspace."
      contextDescription="Verification keeps your job feed, application tracker, documents, saved answers, and profile details tied to the right account."
    >
      <VerifyEmailCard defaultEmail={params.email ?? ""} />
    </AuthShell>
  );
}
