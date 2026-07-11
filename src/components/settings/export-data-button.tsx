"use client";

import { useState } from "react";
import { Download } from "lucide-react";

// Downloads the data export via fetch so a stale-session 401 (the export is
// gated by requireFreshSensitiveSession) shows a friendly re-auth prompt instead
// of navigating the browser to a raw JSON error body.
export function ExportDataButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "reauth" | "error">(
    "idle"
  );

  async function handleExport() {
    setStatus("loading");
    try {
      const response = await fetch("/api/settings/export");

      if (response.status === 401) {
        setStatus("reauth");
        return;
      }
      if (!response.ok) {
        setStatus("error");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        "applyoverflow-export.json";

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleExport}
        disabled={status === "loading"}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        <Download className="h-3 w-3" />
        {status === "loading" ? "Preparing…" : "Download export"}
      </button>
      {status === "reauth" ? (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
          For your security, exporting your data needs a recent sign-in. Sign out
          and back in, then try again.
        </p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 text-xs text-destructive">
          Couldn&apos;t prepare your export. Please try again.
        </p>
      ) : null}
    </div>
  );
}
