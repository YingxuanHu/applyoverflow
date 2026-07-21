export default function DocumentsLoading() {
  return (
    <div className="app-page space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="h-8 w-36 animate-pulse rounded bg-muted" />
          <div className="h-4 w-[32rem] max-w-full animate-pulse rounded bg-muted" />
        </div>
        <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
      </div>

      <DocumentsSectionSkeleton rows={2} titleWidth="w-36" />
      <DocumentsSectionSkeleton rows={4} titleWidth="w-32" />
      <DocumentsSectionSkeleton rows={2} titleWidth="w-44" />
    </div>
  );
}

function DocumentsSectionSkeleton({ rows, titleWidth }: { rows: number; titleWidth: string }) {
  return (
    <section className="border-t border-border/70 pt-6 first:border-t-0 first:pt-0">
      <div className={`h-5 animate-pulse rounded bg-muted ${titleWidth}`} />
      <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3" key={index}>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}
