import { redirect } from "next/navigation";

import { SignInScreen } from "@/components/auth/sign-in-screen";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getPostSignInDestination } from "@/lib/queries/profile-setup";

type HomePageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string; verified?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const sessionUser = await getOptionalSessionUser();
  const params = await searchParams;

  if (sessionUser) {
    redirect(await getPostSignInDestination(sessionUser.id, params.callbackUrl));
  }

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
