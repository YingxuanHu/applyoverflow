import { redirect } from "next/navigation";

import { SignInScreen } from "@/components/auth/sign-in-screen";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { getOptionalSessionUser } from "@/lib/current-user";

type HomePageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string; verified?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const sessionUser = await getOptionalSessionUser();

  if (sessionUser) {
    redirect("/jobs");
  }

  const params = await searchParams;
  const emailVerificationError =
    params.verified === "true" && "error" in params ? String(params.error ?? "") : undefined;

  return (
    <SignInScreen
      callbackUrl={params.callbackUrl || "/jobs"}
      emailVerificationError={emailVerificationError}
      googleEnabled={isGoogleAuthEnabled()}
      justVerified={params.verified === "true" && !emailVerificationError}
      mobileMode="landing"
    />
  );
}
