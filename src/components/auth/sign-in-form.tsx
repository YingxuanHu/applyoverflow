"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type SignInFormProps = {
  callbackUrl?: string;
  defaultEmail?: string;
  emailVerificationError?: string;
  googleError?: string;
  justVerified?: boolean;
  passwordReset?: boolean;
  googleEnabled?: boolean;
};

function getGoogleErrorMessage(error: string | undefined) {
  if (!error) return null;
  if (error === "account_not_linked") {
    return "This Google sign-in is separate from email/password accounts. Sign in with your password account, or use a Google account that was created with Google sign-in.";
  }
  return "Google sign-in could not be completed. Try again or use email and password.";
}

// Only allow same-origin, absolute-path redirects. Rejects protocol-relative
// ("//evil.com"), scheme ("https://evil.com"), and backslash-obfuscated targets
// so a crafted ?callbackUrl cannot turn sign-in into an open redirect.
function toSafeInternalPath(value: string | undefined, fallback = "/jobs"): string {
  if (!value || !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

export function SignInForm({
  callbackUrl = "/jobs",
  defaultEmail = "",
  emailVerificationError,
  googleError,
  justVerified,
  passwordReset,
  googleEnabled = false,
}: SignInFormProps) {
  const router = useRouter();
  const safeCallbackUrl = toSafeInternalPath(callbackUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(getGoogleErrorMessage(googleError));
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setVerificationEmail(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL: "/sign-in?verified=true",
    });

    if (result.error) {
      const message = result.error.message ?? "Unable to sign in.";
      if (message.toLowerCase().includes("verify")) {
        setError("Email not verified. Check your inbox for the verification link.");
        setVerificationEmail(email);
      } else {
        setError("Invalid email or password.");
      }
      setPending(false);
      return;
    }

    router.push(safeCallbackUrl);
    router.refresh();
  };

  return (
    <Card className="w-full rounded-[24px] border-border/60 bg-card/95 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.08)] sm:rounded-[28px] sm:py-5 dark:shadow-none">
      <CardHeader className="gap-2 px-4 sm:px-6">
        <p className="section-label">Welcome back</p>
        <CardTitle className="text-[1.7rem] font-semibold tracking-tight sm:text-3xl">Sign in</CardTitle>
        <CardDescription className="max-w-sm leading-6">
          Continue to your job workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {passwordReset ? (
          <p className="mb-4 rounded-[14px] border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-400">
            Password reset successful. Sign in with your new password.
          </p>
        ) : null}
        {justVerified ? (
          <p className="mb-4 rounded-[14px] border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-400">
            Email verified. You can now sign in.
          </p>
        ) : null}
        {emailVerificationError ? (
          <p className="mb-4 rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
            Verification link is invalid or expired. Request a new verification email.
          </p>
        ) : null}
        <form className="space-y-4" method="post" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">
              Email
            </label>
            <Input
              autoComplete="email"
              className="h-12 rounded-[14px]"
              defaultValue={defaultEmail}
              id="email"
              name="email"
              required
              type="email"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <Input
              autoComplete="current-password"
              className="h-12 rounded-[14px]"
              id="password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>
          <div className="flex justify-end">
            <Link
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              href="/forgot-password"
            >
              Forgot password?
            </Link>
          </div>
          {error ? (
            <p
              aria-live="polite"
              className="rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {verificationEmail ? (
            <Button
              className="h-11 w-full rounded-full"
              render={
                <Link href={`/verify-email-required?email=${encodeURIComponent(verificationEmail)}`} />
              }
              variant="outline"
            >
              Verify email
            </Button>
          ) : null}
          <Button
            className="h-11 w-full rounded-full"
            disabled={pending}
            type="submit"
          >
            {pending ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Need an account?{" "}
            <Link className="text-foreground underline-offset-4 hover:underline" href="/sign-up">
              Create one
            </Link>
          </p>
        </form>
        {googleEnabled ? (
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <GoogleAuthButton
              callbackUrl={safeCallbackUrl}
              onError={(message) => setError(message)}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
