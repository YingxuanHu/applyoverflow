"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";
import { cn } from "@/lib/utils";

type ManualApplyMenuProps = {
  jobId: string;
  applyHref?: string | null;
  align?: "start" | "end";
  buttonVariant?: "default" | "outline" | "secondary" | "ghost";
  buttonSize?: "default" | "sm";
};

export function ManualApplyMenu({
  jobId,
  applyHref,
  align = "start",
  buttonVariant = "default",
  buttonSize = "sm",
}: ManualApplyMenuProps) {
  const router = useRouter();
  const { notify } = useNotifications();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  function addToApplications() {
    if (saving) return;
    setSaving(true);
    fetch(`/api/jobs/${jobId}/save`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("save failed");
        notify({
          title: "Added to applications",
          message: "This job is now in your wishlist.",
          tone: "success",
        });
        setOpen(false);
        router.refresh();
      })
      .catch(() => {
        notify({
          title: "Could not add application",
          message: "Try again from the job page.",
          tone: "error",
        });
      })
      .finally(() => setSaving(false));
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <Button
        aria-expanded={open}
        className="gap-1.5"
        onClick={() => setOpen((current) => !current)}
        size={buttonSize}
        type="button"
        variant={buttonVariant}
      >
        Manual apply
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </Button>

      {open ? (
        <div
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-30 w-56 rounded-xl border border-border/70 bg-background/95 p-1.5 shadow-[0_20px_45px_rgba(15,23,42,0.14)] backdrop-blur",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {applyHref ? (
            <Button
              className="w-full justify-start"
              render={
                <a href={applyHref} rel="noreferrer" target="_blank" />
              }
              size="sm"
              variant="ghost"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open application
            </Button>
          ) : (
            <Button
              className="w-full justify-start"
              disabled
              size="sm"
              type="button"
              variant="ghost"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Application link unavailable
            </Button>
          )}

          <Button
            className="w-full justify-start"
            disabled={saving}
            onClick={addToApplications}
            size="sm"
            type="button"
            variant="ghost"
          >
            {saving ? "Adding..." : "Add to applications"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
