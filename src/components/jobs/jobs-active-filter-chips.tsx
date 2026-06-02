"use client";

import Link from "next/link";
import { useState } from "react";
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
  const [pendingItems, setPendingItems] = useState<Set<string>>(() => new Set());
  const [clearingAll, setClearingAll] = useState(false);

  const visibleGroups = clearingAll
    ? []
    : groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !pendingItems.has(itemKey(group.key, item.key))),
        }))
        .filter((group) => group.items.length > 0);

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
              <Link
                aria-label={`Remove ${group.label}: ${item.label}`}
                className="group/filter-chip inline-flex h-6 max-w-full items-center gap-1 rounded-full px-1.5 transition hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                href={item.href}
                key={item.key}
                onClick={() => {
                  setPendingItems((current) => {
                    const next = new Set(current);
                    next.add(itemKey(group.key, item.key));
                    return next;
                  });
                }}
              >
                <span className="min-w-0 truncate">{item.label}</span>
                <X className="h-3 w-3 shrink-0 transition-colors group-hover/filter-chip:text-white" />
              </Link>
            ))}
          </div>
        ))}
      </div>
      <Link
        className="group/filter-chip inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-input/80 bg-background/70 px-3 text-xs font-medium text-foreground transition hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:ml-3"
        href={clearHref}
        onClick={() => setClearingAll(true)}
      >
        <X className="h-3.5 w-3.5 transition-colors group-hover/filter-chip:text-white" />
        Clear all
      </Link>
    </div>
  );
}

function itemKey(groupKey: string, itemKeyValue: string) {
  return `${groupKey}:${itemKeyValue}`;
}
