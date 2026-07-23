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
      aria-busy="true"
      className="pointer-events-auto fixed inset-0 z-50 overflow-hidden"
      role="status"
    >
      <div className="absolute inset-0 animate-pulse bg-primary/[0.035] dark:bg-primary/[0.07]" />
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-border/60">
        <div className="jobs-loading-sweep h-full bg-primary" />
      </div>
      <div className="absolute inset-x-0 top-5 flex justify-center px-4 sm:top-6">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <LoadingSpinner className="h-4 w-4 text-primary" />
          <span>{label}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="hidden text-muted-foreground sm:inline">{description}</span>
          <span className="sr-only">{description}</span>
        </div>
      </div>
    </div>
  );
}
