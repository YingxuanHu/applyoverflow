"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Briefcase,
  FileCheck2,
  FileText,
  Menu,
  Settings,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type MobileNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string, tab: string | null) => boolean;
};

const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  {
    href: "/jobs/top-picks",
    label: "Picks for you",
    icon: Sparkles,
    isActive: (pathname) =>
      pathname === "/jobs/top-picks" || pathname.startsWith("/jobs/top-picks/"),
  },
  {
    href: "/jobs",
    label: "Jobs",
    icon: Briefcase,
    isActive: (pathname) =>
      pathname === "/jobs" ||
      (pathname.startsWith("/jobs/") && !pathname.startsWith("/jobs/top-picks")),
  },
  {
    href: "/applications",
    label: "Applications",
    icon: FileCheck2,
    isActive: (pathname) =>
      pathname === "/applications" || pathname.startsWith("/applications/"),
  },
  {
    href: "/profile?tab=documents",
    label: "Documents",
    icon: FileText,
    isActive: (pathname, tab) =>
      pathname.startsWith("/documents") ||
      (pathname === "/profile" && tab === "documents"),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: User,
    isActive: (pathname, tab) =>
      (pathname === "/profile" && tab !== "documents") ||
      pathname.startsWith("/profile/"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    isActive: (pathname) =>
      pathname === "/settings" || pathname.startsWith("/settings/"),
  },
];

export function MobileNavSheet() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const [open, setOpen] = useState(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        render={
          <Button
            aria-label="Open navigation"
            className="size-10 rounded-full md:hidden"
            size="icon"
            type="button"
            variant="secondary"
          />
        }
      >
        <Menu className="size-4" />
      </SheetTrigger>
      <SheetContent
        className="w-[min(22rem,calc(100vw-1rem))] gap-0 border-border/70 bg-background p-0"
        side="right"
      >
        <SheetHeader className="border-b border-border/60 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
          <BrandLogo iconClassName="size-8" textClassName="text-base" />
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Move between ApplyOverflow workspace sections.
          </SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="grid gap-1 p-3">
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.isActive(pathname, tab);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 min-w-0 items-center gap-3 rounded-[14px] px-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                )}
                href={item.href}
                key={item.href}
                onClick={() => setOpen(false)}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
