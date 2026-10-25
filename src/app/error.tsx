"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" && /^\d{1,20}$/.test(error.digest)
    ? error.digest : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-24 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        Something went wrong
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We couldn&apos;t load this page. Wait a moment, then try again. You do not
        need to sign out. Keep any open application or editor tabs open.
      </p>
      {digest ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground/60">
          Error ID: {digest}
        </p>
      ) : null}
      <Button onClick={() => retry()} variant="outline" size="sm" className="mt-6">
        <RotateCw className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
