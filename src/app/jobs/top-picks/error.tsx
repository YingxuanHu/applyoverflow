"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

const MAX_AUTO_RECOVERY_ATTEMPTS = 3;
const AUTO_RECOVERY_DELAY_MS = 450;
const RECOVERY_ATTEMPT_MAX_AGE_MS = 45_000;

export default function TopPicksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = useMemo(
    () => `${pathname}${searchParams.size > 0 ? `?${searchParams}` : ""}`,
    [pathname, searchParams]
  );
  const recoveryStorageKey = `applyoverflow.top-picks.error-recovery:${routeKey}`;
  const isRecovering = canAttemptRecovery(recoveryStorageKey);

  useEffect(() => {
    console.error("Top picks page error:", error);
  }, [error]);

  useEffect(() => {
    const current = readRecoveryAttempt(recoveryStorageKey);
    if (current.count >= MAX_AUTO_RECOVERY_ATTEMPTS) return;

    const nextCount = current.count + 1;
    window.sessionStorage.setItem(
      recoveryStorageKey,
      JSON.stringify({ count: nextCount, updatedAt: Date.now() })
    );

    const timeout = window.setTimeout(() => {
      reset();
    }, AUTO_RECOVERY_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [recoveryStorageKey, reset]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <h2 className="text-lg font-semibold text-foreground">
        {isRecovering ? "Reconnecting to top picks" : "Could not load top picks"}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {isRecovering
          ? "Keeping your place while recommendations reconnect."
          : "Top picks did not respond after retrying."}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button
          onClick={() => {
            window.sessionStorage.removeItem(recoveryStorageKey);
            reset();
          }}
          variant="outline"
          size="sm"
        >
          {isRecovering ? "Retrying…" : "Try again"}
        </Button>
        <Button variant="ghost" size="sm" render={<Link href="/jobs/top-picks" />}>
          Reset top picks
        </Button>
        <Button variant="ghost" size="sm" render={<Link href="/jobs" />}>
          Open job board
        </Button>
      </div>
    </div>
  );
}

function canAttemptRecovery(storageKey: string) {
  if (typeof window === "undefined") return true;
  return readRecoveryAttempt(storageKey).count < MAX_AUTO_RECOVERY_ATTEMPTS;
}

function readRecoveryAttempt(storageKey: string) {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return { count: 0 };
    const parsed = JSON.parse(raw) as {
      count?: unknown;
      updatedAt?: unknown;
    };
    const count = typeof parsed.count === "number" ? parsed.count : 0;
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    if (Date.now() - updatedAt > RECOVERY_ATTEMPT_MAX_AGE_MS) {
      window.sessionStorage.removeItem(storageKey);
      return { count: 0 };
    }
    return { count };
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return { count: 0 };
  }
}
