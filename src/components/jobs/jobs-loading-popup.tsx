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
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      role="status"
    >
      <div className="absolute inset-0 animate-pulse bg-primary/[0.035] dark:bg-primary/[0.07]" />
      <span className="sr-only">{label}. {description}</span>
    </div>
  );
}
