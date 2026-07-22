import { LoadingSpinner } from "@/components/ui/loading-spinner";

type JobsLoadingPopupProps = {
  description?: string;
  label?: string;
};

export function JobsLoadingPopup({
  description = "Updating the job list with your latest search and filters.",
  label = "Loading jobs",
}: JobsLoadingPopupProps) {
  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/55 px-4 pt-24 sm:pt-32"
      role="status"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-border/80 bg-popover px-4 py-3 text-left shadow-[0_18px_48px_rgba(0,0,0,0.26)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LoadingSpinner className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
