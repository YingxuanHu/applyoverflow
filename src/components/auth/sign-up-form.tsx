"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";

const RESEND_COOLDOWN_SECONDS = 30;

type SignUpStatusResponse = {
  exists?: boolean;
  emailVerified?: boolean;
  disabled?: boolean;
};

type VerificationResponse = {
  status?: "sent" | "already_verified" | "not_found" | "delivery_failed" | "rate_limited";
  message?: string;
};

function isExistingAccountError(error: { code?: string; message?: string }) {
  const value = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    value.includes("already") ||
    value.includes("exist") ||
    value.includes("duplicate") ||
    value.includes("unique")
  );
}

async function getSignUpStatus(email: string) {
  const response = await fetch(`/api/auth/sign-up-status?email=${encodeURIComponent(email)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not check sign-up status.");
  }

  return (await response.json()) as SignUpStatusResponse;
}

async function requestVerificationEmail(email: string) {
  const response = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      callbackURL: "/?verified=true",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as VerificationResponse;

  return {
    ok: response.ok,
    status: body.status,
    message: body.message,
  };
}

export function SignUpForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [existingEmailVerified, setExistingEmailVerified] = useState<boolean | null>(null);
  const [resendPending, setResendPending] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (resendCooldownSeconds <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setResendCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setExistingEmail(null);
    setExistingEmailVerified(null);
    setResendMessage(null);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }

    let status: SignUpStatusResponse;
    try {
      status = await getSignUpStatus(email);
    } catch {
      setError("Unable to check whether this email is already registered. Try again.");
      setPending(false);
      return;
    }

    if (status.exists) {
      setExistingEmail(email);
      setExistingEmailVerified(Boolean(status.emailVerified));
      setPending(false);
      return;
    }

    const result = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/?verified=true",
      emailNotificationsEnabled,
    } as Parameters<typeof authClient.signUp.email>[0]);

    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (code.includes("INVALID_EMAIL")) {
        setError("Enter a valid email address.");
      } else if (isExistingAccountError({ code, message })) {
        setExistingEmail(email);
        setExistingEmailVerified(null);
      } else if (code.includes("PASSWORD")) {
        setError("Use a password between 8 and 128 characters.");
      } else {
        setError("Unable to create account. Check the details and try again.");
      }
      setPending(false);
      return;
    }

    const verificationResult = await requestVerificationEmail(email);

    if (!verificationResult.ok || verificationResult.status !== "sent") {
      setExistingEmail(email);
      setExistingEmailVerified(false);
      setError(
        verificationResult.message ??
          "Account created, but the verification email could not be sent. Try resending it."
      );
      setPending(false);
      return;
    }

    router.push(`/verify-email-required?email=${encodeURIComponent(email)}`);
    router.refresh();
  };

  const resendVerification = async () => {
    if (!existingEmail || resendCooldownSeconds > 0) {
      return;
    }

    setResendPending(true);
    setError(null);
    setResendMessage(null);

    const result = await requestVerificationEmail(existingEmail);

    if (!result.ok || !result.status) {
      setError(result.message ?? "Unable to send verification email right now. Try again later.");
      setResendPending(false);
      return;
    }

    if (result.status === "already_verified") {
      setExistingEmailVerified(true);
      setResendMessage("This email is already verified. Sign in instead.");
    } else if (result.status === "sent") {
      setExistingEmailVerified(false);
      setResendMessage("Verification email sent. Check your inbox and spam folder.");
      setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    } else {
      setError(result.message ?? "Unable to send verification email right now. Try again later.");
    }
    setResendPending(false);
  };

  return (
    <Card className="w-full max-w-md rounded-[24px] border-border/60 bg-card/95 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.08)] sm:rounded-[28px] sm:py-5 dark:shadow-none">
      <CardHeader className="gap-2 px-4 sm:px-6">
        <p className="section-label">Start clean</p>
        <CardTitle className="text-[1.7rem] font-semibold tracking-tight sm:text-3xl">Create account</CardTitle>
        <CardDescription className="max-w-sm leading-6">
          Create one workspace for jobs, applications, documents, and reminders.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <form className="space-y-4" method="post" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="name">
              Name
            </label>
            <Input autoComplete="name" className="h-12 rounded-[14px]" id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">
              Email
            </label>
            <Input
              autoComplete="email"
              className="h-12 rounded-[14px]"
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
              autoComplete="new-password"
              className="h-12 rounded-[14px]"
              id="password"
              minLength={8}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <p
              className={
                password.length >= 8
                  ? "text-xs text-emerald-700 dark:text-emerald-400"
                  : "text-xs text-destructive"
              }
            >
              Must contain at least 8 characters
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="confirmPassword">
              Confirm password
            </label>
            <Input
              autoComplete="new-password"
              className="h-12 rounded-[14px]"
              id="confirmPassword"
              minLength={8}
              name="confirmPassword"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </div>
          <label className="flex items-start gap-3 rounded-[16px] border border-border/70 bg-muted/45 px-3.5 py-3 text-sm">
            <input
              checked={emailNotificationsEnabled}
              className="mt-1"
              onChange={(event) => setEmailNotificationsEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>Email me deadline reminders</span>
          </label>
          {error ? (
            <p
              aria-live="polite"
              className="rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {existingEmail ? (
            <div className="space-y-3 rounded-[18px] border border-border/70 bg-muted/45 px-4 py-4 text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {existingEmailVerified
                    ? "This email is already registered."
                    : "This email is already registered but still needs verification."}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {existingEmailVerified
                    ? `Sign in with ${existingEmail} instead.`
                    : `Resend verification for ${existingEmail}, then sign in.`}
                </p>
              </div>
              {resendMessage ? (
                <p className="rounded-[14px] border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-emerald-700 dark:text-emerald-400">
                  {resendMessage}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="h-10 flex-1 rounded-full"
                  render={<Link href={`/sign-in?email=${encodeURIComponent(existingEmail)}`} />}
                  variant="outline"
                >
                  Sign in
                </Button>
                <Button
                  className="h-10 flex-1 rounded-full"
                  render={
                    <Link href={`/forgot-password?email=${encodeURIComponent(existingEmail)}`} />
                  }
                  variant="outline"
                >
                  Reset password
                </Button>
              </div>
              {existingEmailVerified ? null : (
                <Button
                  className="h-10 w-full rounded-full"
                  disabled={resendPending || resendCooldownSeconds > 0}
                  onClick={resendVerification}
                  type="button"
                  variant="ghost"
                >
                  {resendPending
                    ? "Sending..."
                    : resendCooldownSeconds > 0
                      ? `Resend available in ${resendCooldownSeconds}s`
                      : "Resend verification email"}
                </Button>
              )}
            </div>
          ) : null}
          <Button
            className="h-11 w-full rounded-full"
            disabled={pending}
            type="submit"
          >
            {pending ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Creating...
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
        {googleEnabled ? (
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <GoogleAuthButton mode="sign-up" />
          </div>
        ) : null}
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link className="text-foreground underline-offset-4 hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
