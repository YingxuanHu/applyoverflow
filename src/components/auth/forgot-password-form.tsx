"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ForgotPasswordFormProps = {
  defaultEmail?: string;
};

export function ForgotPasswordForm({ defaultEmail = "" }: ForgotPasswordFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    if (!email) {
      setError("Enter your email.");
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok && response.status !== 429) {
        setError("Unable to send reset instructions right now. Try again.");
      } else {
        setMessage("If an account exists for this email, we sent reset instructions.");
      }
    } catch {
      setError("Unable to send reset instructions right now. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="w-full max-w-md rounded-[28px] border-border/60 bg-card/95 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] dark:shadow-none">
      <CardHeader className="gap-2 px-6">
        <p className="section-label">Account recovery</p>
        <CardTitle className="text-3xl font-semibold tracking-tight">Reset access</CardTitle>
        <CardDescription className="max-w-sm leading-6">
          Enter your email. If there is an account, we&apos;ll send a secure reset link.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
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
          {error ? (
            <p
              aria-live="polite"
              className="rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {message ? (
            <p
              aria-live="polite"
              className="rounded-[14px] border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-400"
            >
              {message}
            </p>
          ) : null}
          <Button
            className="h-11 w-full rounded-full"
            disabled={pending}
            type="submit"
          >
            {pending ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Remembered your password?{" "}
          <Link className="text-foreground underline-offset-4 hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
