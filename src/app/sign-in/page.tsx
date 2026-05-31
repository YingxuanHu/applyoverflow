import { redirect } from "next/navigation";

import { SignInScreen } from "@/components/auth/sign-in-screen";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { getOptionalSessionUser } from "@/lib/current-user";

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string; email?: string; verified?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const sessionUser = await getOptionalSessionUser();

  if (sessionUser) {
    redirect("/jobs");
  }

  const params = await searchParams;
  return (
    <SignInScreen
      callbackUrl={params.callbackUrl || "/jobs"}
      defaultEmail={params.email ?? ""}
      googleEnabled={isGoogleAuthEnabled()}
      justVerified={params.verified === "true"}
    />
  );
}
