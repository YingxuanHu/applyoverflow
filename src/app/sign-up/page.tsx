import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { getOptionalSessionUser } from "@/lib/current-user";

export default async function SignUpPage() {
  const sessionUser = await getOptionalSessionUser();

  if (sessionUser) {
    redirect("/jobs");
  }

  return (
    <AuthShell
      contextTitle="Build a workspace around the jobs worth applying to."
      contextDescription="Set up once, then use better job signals, reusable documents, saved answers, and reminders across every application."
      footer={null}
    >
      <SignUpForm googleEnabled={isGoogleAuthEnabled()} />
    </AuthShell>
  );
}
