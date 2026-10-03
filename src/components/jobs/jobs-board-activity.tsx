import type { ReactNode } from "react";
import { formatPostedAge } from "@/lib/job-display";

export function JobsBoardActivity({ children, addedToday, closedToday, updatedAt }: {
  children: ReactNode;
  addedToday: number;
  closedToday: number;
  updatedAt: Date | string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {children}
        {updatedAt ? <p className="text-sm text-muted-foreground">Updated {formatPostedAge(updatedAt)}</p> : null}
      </div>
      <section aria-label="Board activity" className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h3 className="text-sm font-semibold text-foreground">Board activity</h3>
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <dt className="order-2 text-sm text-muted-foreground">New today</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">{addedToday.toLocaleString()}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="order-2 text-sm text-muted-foreground">Closed today</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">{closedToday.toLocaleString()}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
