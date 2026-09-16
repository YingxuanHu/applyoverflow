import Link from "next/link";

import { cn } from "@/lib/utils";

const JOBS_SECTION_TABS = [
  {
    href: "/jobs",
    key: "jobs",
    label: "Jobs",
  },
  {
    href: "/jobs/top-picks",
    key: "top-picks",
    label: "Picks for you",
  },
] as const;

type JobsSectionTabKey = (typeof JOBS_SECTION_TABS)[number]["key"];

export function JobsSectionTabs({ active }: { active: JobsSectionTabKey }) {
  return (
    <nav
      aria-label="Jobs workspace"
      className="flex items-center gap-5"
    >
      {JOBS_SECTION_TABS.map((tab) => {
        const isActive = active === tab.key;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 px-1 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
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
