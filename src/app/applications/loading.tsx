export default function ApplicationsLoading() {
  return (
    <div className="app-page app-page-workspace space-y-6" aria-busy="true" aria-label="Loading applications">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="h-8 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 w-20 animate-pulse rounded-md bg-muted" />
        ))}
      </div>

      {/* Application rows */}
      <div className="pt-1 space-y-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b border-border py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                </div>
                <div className="flex gap-2">
                  <div className="h-3 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-3 w-40 animate-pulse rounded bg-muted" />
              </div>
              <div className="flex gap-2">
                <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
                <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
