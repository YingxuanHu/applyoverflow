import Link from "next/link";
import { X } from "lucide-react";

type ActiveFilterGroup = {
  key: string;
  label: string;
  items: Array<{
    key: string;
    label: string;
    href: string;
  }>;
};

export function JobsActiveFilterChips({
  clearHref,
  groups,
}: {
  clearHref: string;
  groups: ActiveFilterGroup[];
}) {
  const visibleGroups = groups.filter((group) => group.items.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {visibleGroups.map((group) => (
          <div
            className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-border/70 bg-card py-1 pl-3 pr-1.5 text-xs text-muted-foreground"
            key={group.key}
          >
            <span className="font-semibold text-foreground">{group.label}:</span>
            {group.items.map((item) => (
              <span
                className="inline-flex h-6 max-w-full items-center gap-1 rounded-full px-1.5"
                key={item.key}
              >
                <span className="min-w-0 truncate">{item.label}</span>
                <Link
                  aria-label={`Remove ${group.label}: ${item.label}`}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                  href={item.href}
                >
                  <X className="h-3 w-3" />
                </Link>
              </span>
            ))}
          </div>
        ))}
      </div>
      <Link
        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-input/80 bg-background/70 px-3 text-xs font-medium text-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 sm:ml-3"
        href={clearHref}
      >
        <X className="h-3.5 w-3.5" />
        Clear all
      </Link>
    </div>
  );
}
