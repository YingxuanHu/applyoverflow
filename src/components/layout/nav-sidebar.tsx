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
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PRIMARY_NAV_ITEMS = [
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/applications", label: "Applications", icon: FileCheck2 },
];

const PROFILE_LINKS = [
  { href: "/profile?tab=documents", label: "Documents" },
  { href: "/profile?tab=details#job-preferences", label: "Job preferences" },
  { href: "/profile?tab=details#application-profile", label: "Application profile" },
];

const SETTINGS_LINKS = [
  { href: "/settings#account", label: "Account" },
  { href: "/settings#automation", label: "Automation" },
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

  const isProfileActive = pathname === "/profile" || pathname.startsWith("/profile/");
  const isSettingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar md:flex">
      <div className="px-4 py-5">
        <Link
          className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent"
          href="/jobs"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background">
            <Zap className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              AutoApplication
            </p>
            <p className="text-xs text-muted-foreground">Jobs first. Apply faster.</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 pb-4">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        <NavGroup
          defaultOpen={isProfileActive}
          href="/profile"
          icon={User}
          isActive={isProfileActive}
          label="Profile"
          links={PROFILE_LINKS}
        />
        <NavGroup
          defaultOpen={isSettingsActive}
          href="/settings"
          icon={Settings}
          isActive={isSettingsActive}
          label="Settings"
          links={SETTINGS_LINKS}
        />

        <div className="pt-4">
          <Link
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
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
  defaultOpen,
  href,
  icon: Icon,
  isActive,
  label,
  links,
}: {
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
      <div className="flex items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground">
        <Link
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent hover:text-foreground"
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
        <div className="ml-7 mt-1 grid gap-1 border-l border-border pl-3">
          {links.map((link) => (
            <Link
              className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
