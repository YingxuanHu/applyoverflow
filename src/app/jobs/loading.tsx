import { JobsLoadingPopup } from "@/components/jobs/jobs-loading-popup";

export default function JobsLoading() {
  return (
    <>
      <JobsLoadingPopup />
      <div aria-hidden="true" className="app-page app-page-workspace space-y-6 animate-pulse motion-reduce:animate-none">
        <header className="page-header items-center justify-start gap-x-10"><div className="h-8 w-24 rounded bg-muted" /><div className="flex gap-5"><div className="h-8 w-16 rounded bg-muted" /><div className="h-8 w-28 rounded bg-muted" /></div></header>
        <div className="space-y-4 border-b border-border/60 pb-4">
          <div className="h-6 w-44 rounded bg-muted" />
          <div className="flex gap-3">
            <div className="h-10 min-w-0 flex-1 rounded-md bg-muted" />
            <div className="h-10 w-20 rounded-md bg-muted" />
          </div>
          <div className="h-5 w-28 rounded bg-muted" />
        </div>
        <div className="flex gap-2"><div className="size-9 rounded bg-muted" /><div className="size-9 rounded bg-muted" /><div className="h-9 w-28 rounded bg-muted" /></div>
        <div className="job-workspace min-h-96">
          <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="space-y-3 p-5">
                <div className="h-5 w-4/5 rounded bg-muted" />
                <div className="h-4 w-2/5 rounded bg-muted" />
                <div className="h-3 w-3/5 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="hidden space-y-6 overflow-hidden rounded-lg border border-border/60 p-6 lg:block">
            <div className="h-7 w-4/5 rounded bg-muted" />
            <div className="h-4 w-1/3 rounded bg-muted" />
            <div className="h-16 rounded bg-muted/60" />
            <div className="space-y-3 border-t border-border/60 pt-6">
              {Array.from({ length: 12 }, (_, index) => <div key={index} className={`h-3 rounded bg-muted ${index % 4 === 3 ? "w-2/3" : "w-full"}`} />)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
