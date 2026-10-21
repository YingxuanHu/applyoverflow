import Link from "next/link";

import { cn } from "@/lib/utils";
import { JOBS_WORKSPACE_LINKS, type JobsWorkspaceTab } from "@/lib/navigation/jobs-workspace";

export function JobsSectionTabs({ active }: { active: JobsWorkspaceTab }) {
  return (
    <nav
      aria-label="Jobs workspace"
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-5"
    >
      {JOBS_WORKSPACE_LINKS.map((tab) => {
        const isActive = active === tab.key;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "min-h-11 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
            href={tab.href}
            key={tab.key}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
