import { redirect } from "next/navigation";

import {
  DEFAULT_VERIFICATION_CALLBACK_URL,
  normalizeVerificationCallbackURL,
} from "@/lib/auth-verification";

type VerifyEmailPageProps = {
  searchParams: Promise<{
    token?: string;
    callbackURL?: string;
  }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = String(params.token ?? "").trim();

  if (!token) {
    redirect(`${DEFAULT_VERIFICATION_CALLBACK_URL}&error=INVALID_TOKEN`);
  }

  const callbackURL = normalizeVerificationCallbackURL(params.callbackURL);
  const verifyPath = new URLSearchParams({
    token,
    callbackURL,
  });

  redirect(`/api/auth/verify-email?${verifyPath.toString()}`);
}
