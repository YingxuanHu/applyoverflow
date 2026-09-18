import { redirect } from "next/navigation";

import { SignInScreen } from "@/components/auth/sign-in-screen";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getSafeSignInCallback } from "@/lib/auth-return-path";
import { getPostSignInDestination } from "@/lib/queries/profile-setup";
import { isLocalDevelopmentAuthEnabled, LOCAL_DEVELOPMENT_ADMIN } from "@/lib/local-development-auth";

type SignInPageProps = {
  searchParams: Promise<{
    callbackUrl?: string;
    email?: string;
    error?: string;
    google?: string;
    passwordReset?: string;
    verified?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const sessionUser = await getOptionalSessionUser();
  const params = await searchParams;
  const callbackUrl = getSafeSignInCallback(params.callbackUrl);

  if (sessionUser) {
    redirect(await getPostSignInDestination(sessionUser.id, callbackUrl));
  }

  const localDevelopmentAccount = isLocalDevelopmentAuthEnabled();
  const emailVerificationError =
    params.verified === "true" && params.error ? params.error : undefined;

  return (
    <SignInScreen
      callbackUrl={callbackUrl}
      defaultEmail={params.email ?? (localDevelopmentAccount ? LOCAL_DEVELOPMENT_ADMIN.username : "")}
      emailVerificationError={emailVerificationError}
      googleError={params.google === "error" ? params.error ?? "google_error" : undefined}
      googleEnabled={isGoogleAuthEnabled()}
      justVerified={params.verified === "true" && !emailVerificationError}
      localDevelopmentAccount={localDevelopmentAccount}
      passwordReset={params.passwordReset === "true"}
    />
  );
}
