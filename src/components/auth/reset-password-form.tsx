"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ResetPasswordFormProps = {
  token?: string;
  errorCode?: string;
};

export function ResetPasswordForm({ token, errorCode }: ResetPasswordFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const initialError = useMemo(() => {
    if (!token) {
      return "Missing reset token. Request a new password reset link.";
    }
    if (errorCode === "INVALID_TOKEN") {
      return "This reset link is invalid or expired. Request a new one.";
    }
    if (errorCode) {
      return "Unable to use this reset link. Request a new one.";
    }
    return null;
  }, [errorCode, token]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    if (!token) {
      setError("Missing reset token. Request a new password reset link.");
      setPending(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newPassword: password,
          token,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Unable to reset password. Request a new link and try again.");
        return;
      }

      router.replace("/sign-in?passwordReset=true");
      router.refresh();
    } catch {
      setError("Unable to reset password. Request a new link and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="w-full max-w-md rounded-[28px] border-border/60 bg-card/95 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] dark:shadow-none">
      <CardHeader className="gap-2 px-6">
        <p className="section-label">Secure update</p>
        <CardTitle className="text-3xl font-semibold tracking-tight">New password</CardTitle>
        <CardDescription className="max-w-sm leading-6">
          Choose a new password, then sign in again to continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <form className="space-y-4" method="post" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              New password
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
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="confirmPassword">
              Confirm new password
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
          {initialError ? (
            <p className="rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
              {initialError}
            </p>
          ) : null}
          {error ? (
            <p
              aria-live="polite"
              className="rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          <Button
            className="h-11 w-full rounded-full"
            disabled={pending || !token}
            type="submit"
          >
            {pending ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Updating...
              </>
            ) : (
              "Reset password"
            )}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Need another link?{" "}
          <Link className="text-foreground underline-offset-4 hover:underline" href="/forgot-password">
            Request reset email
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
