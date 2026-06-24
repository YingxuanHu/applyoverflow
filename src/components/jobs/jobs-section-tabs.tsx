import Link from "next/link";

import { cn } from "@/lib/utils";

const JOBS_SECTION_TABS = [
  {
    href: "/jobs",
    key: "jobs",
    label: "Jobs",
    description: "Full searchable job board",
  },
  {
    href: "/jobs/top-picks",
    key: "top-picks",
    label: "Picks for you",
    description: "Ranked matches from your profile",
  },
] as const;

type JobsSectionTabKey = (typeof JOBS_SECTION_TABS)[number]["key"];

export function JobsSectionTabs({ active }: { active: JobsSectionTabKey }) {
  return (
    <nav
      aria-label="Jobs workspace"
      className="grid w-full max-w-[560px] grid-cols-2 gap-1 rounded-[16px] border border-border/70 bg-muted/25 p-1"
    >
      {JOBS_SECTION_TABS.map((tab) => {
        const isActive = active === tab.key;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-[12px] border px-4 py-3 text-sm transition-colors",
              isActive
                ? "border-border/70 bg-background text-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground"
            )}
            href={tab.href}
            key={tab.key}
          >
            <span className="block text-[15px] font-semibold leading-5">{tab.label}</span>
            <span
              className={cn(
                "mt-0.5 block text-xs leading-4",
                isActive ? "text-muted-foreground" : "text-muted-foreground/85"
              )}
            >
              {tab.description}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
