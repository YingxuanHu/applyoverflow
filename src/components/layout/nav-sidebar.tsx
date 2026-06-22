"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Briefcase,
  ChevronDown,
  FileCheck2,
  FileText,
  Settings,
  User,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

const PRIMARY_NAV_ITEMS = [
  { href: "/applications", label: "Applications", icon: FileCheck2 },
  { href: "/profile?tab=documents", label: "Documents", icon: FileText },
];

const JOBS_LINKS = [
  { href: "/jobs/top-picks", label: "Picks for you" },
  { href: "/jobs", label: "Jobs" },
];

const PROFILE_LINKS = [
  { href: "/profile?tab=details#application-profile", label: "Application profile" },
  { href: "/profile?tab=details#job-preferences", label: "Job preferences" },
];

const SETTINGS_LINKS = [
  { href: "/settings#account", label: "Account" },
  { href: "/settings#notifications", label: "Notifications" },
];

const AUTH_ROUTES = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email-required",
]);

export function NavSidebar() {
  const pathname = usePathname();
  const hideSidebar = Array.from(AUTH_ROUTES).some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  if (hideSidebar) {
    return null;
  }

  const isDocumentsActive = pathname.startsWith("/documents");
  const isJobsActive = pathname === "/jobs" || pathname.startsWith("/jobs/");
  const isProfileActive = pathname === "/profile" || pathname.startsWith("/profile/");
  const isSettingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar md:flex">
      <div className="px-4 py-5">
        <Link
          className="flex items-center gap-3 rounded-[14px] px-2 py-2 transition-colors hover:bg-sidebar-accent"
          href="/jobs"
        >
          <BrandLogo
            iconClassName="size-9"
            textClassName="text-base text-foreground"
          />
        </Link>
      </div>

      <nav className="flex-1 space-y-5 px-3 pb-4">
        <div className="space-y-1">
          <NavGroup
            activePathname={pathname}
            defaultOpen={isJobsActive}
            href="/jobs"
            icon={Briefcase}
            isActive={isJobsActive}
            label="Jobs"
            links={JOBS_LINKS}
          />
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive =
              item.label === "Documents"
                ? isDocumentsActive
                : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary/[0.12] text-sidebar-primary dark:bg-sidebar-primary/[0.18]"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="space-y-1">
        <NavGroup
          activePathname={pathname}
          defaultOpen={isProfileActive}
          href="/profile"
          icon={User}
          isActive={isProfileActive}
          label="Profile"
          links={PROFILE_LINKS}
        />
        <NavGroup
          activePathname={pathname}
          defaultOpen={isSettingsActive}
          href="/settings"
          icon={Settings}
          isActive={isSettingsActive}
          label="Settings"
          links={SETTINGS_LINKS}
        />
        </div>

        <div className="border-t border-sidebar-border pt-4">
          <Link
            className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            href="/documents/compare"
          >
            <FileText className="h-4 w-4" />
            Compare documents
          </Link>
        </div>
      </nav>
    </aside>
  );
}

function NavGroup({
  activePathname,
  defaultOpen,
  href,
  icon: Icon,
  isActive,
  label,
  links,
}: {
  activePathname: string;
  defaultOpen: boolean;
  href: string;
  icon: LucideIcon;
  isActive: boolean;
  label: string;
  links: Array<{ href: string; label: string }>;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 rounded-[12px] text-sm font-medium text-muted-foreground">
        <Link
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-[12px] px-3 py-2.5 transition-colors",
            isActive
              ? "bg-sidebar-accent text-foreground"
              : "hover:bg-sidebar-accent hover:text-foreground"
          )}
          href={href}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Link>
        <button
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-sidebar-accent hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open ? "rotate-180" : ""
            )}
          />
        </button>
      </div>
      {open ? (
        <div className="ml-7 mt-1 grid gap-1 border-l border-sidebar-border pl-3">
          {links.map((link) => {
            const active = isNestedNavLinkActive(link.href, activePathname);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-[10px] px-2 py-1.5 text-xs font-medium transition-colors hover:bg-sidebar-accent hover:text-foreground",
                  active
                    ? "bg-sidebar-primary/[0.12] text-sidebar-primary dark:bg-sidebar-primary/[0.18]"
                    : "text-muted-foreground"
                )}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function isNestedNavLinkActive(href: string, pathname: string) {
  if (href === "/jobs") {
    return pathname === "/jobs" || (pathname.startsWith("/jobs/") && !pathname.startsWith("/jobs/top-picks"));
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
