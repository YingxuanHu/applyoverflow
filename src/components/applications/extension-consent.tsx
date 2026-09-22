"use client";

import { useState, useTransition } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveExtension } from "@/app/extension/connect/actions";

export function ExtensionConsent({
  request,
}: {
  request: { clientId: string; challenge: string; state: string };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <div className="space-y-4">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await approveExtension(request);
              if (result?.reauthenticateUrl) window.location.assign(result.reauthenticateUrl);
              if (result?.error) setError(result.error);
            } catch {
              setError("Could not connect. Start again in the extension.");
            }
          })
        }
      >
        <Link2 className="size-4" />
        {pending ? "Connecting..." : "Allow connection"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
