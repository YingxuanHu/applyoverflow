"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type VerifyEmailCardProps = {
  defaultEmail?: string;
};

const RESEND_COOLDOWN_SECONDS = 30;

type VerificationResponse = {
  status?: "sent" | "already_verified" | "not_found" | "delivery_failed" | "rate_limited";
  message?: string;
};

export function VerifyEmailCard({ defaultEmail = "" }: VerifyEmailCardProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [pending, setPending] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(
    defaultEmail
      ? `If a verification email was sent to ${defaultEmail}, check your inbox and spam folder. You can resend it below.`
      : null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const resend = async () => {
    if (cooldownSeconds > 0) {
      setError(`Please wait ${cooldownSeconds}s before resending.`);
      return;
    }

    if (!email) {
      setError("Enter your email to resend verification.");
      return;
    }

    setPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        callbackURL: "/sign-in?verified=true",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as VerificationResponse;

    if (!response.ok || !result.status) {
      setError(result.message ?? "Unable to send verification email right now. Try again later.");
      setPending(false);
      return;
    }

    if (result.status === "sent") {
      setMessage("Verification email sent. Check your inbox and spam folder.");
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    } else if (result.status === "already_verified") {
      setMessage("This email is already verified. Sign in instead.");
    } else {
      setError(result.message ?? "Unable to send verification email right now. Try again later.");
    }
    setPending(false);
  };

  return (
    <Card className="w-full max-w-md rounded-[28px] border-border/60 bg-card/95 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] dark:shadow-none">
      <CardHeader className="gap-2 px-6">
        <p className="section-label">One more step</p>
        <CardTitle className="text-3xl font-semibold tracking-tight">Verify email</CardTitle>
        <CardDescription className="max-w-sm leading-6">
          Confirm the address that protects your profile, tracker, and documents.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="verify-email">
            Email
          </label>
          <Input
            autoComplete="email"
            className="h-12 rounded-[14px]"
            id="verify-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </div>
        {error ? (
          <p
            aria-live="polite"
            className="mt-4 rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            aria-live="polite"
            className="mt-4 rounded-[14px] border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-400"
          >
            {message}
          </p>
        ) : null}
        <Button
          className="mt-5 h-11 w-full rounded-full"
          disabled={pending || cooldownSeconds > 0}
          onClick={resend}
          type="button"
        >
          {pending
            ? "Sending..."
            : cooldownSeconds > 0
              ? `Resend available in ${cooldownSeconds}s`
              : "Resend verification email"}
        </Button>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already verified?{" "}
          <Link className="text-foreground underline-offset-4 hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
