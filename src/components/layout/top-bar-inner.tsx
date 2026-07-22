"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { MobileNavSheet } from "@/components/layout/mobile-nav-sheet";
import { UserMenu } from "@/components/layout/user-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const AUTH_ROUTES = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email-required",
]);

type SessionSnapshot = {
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
};

export function TopBarInner({
  unreadNotificationCount = 0,
  user,
}: {
  unreadNotificationCount?: number;
  user: SessionSnapshot | null;
}) {
  const pathname = usePathname();
  const hide = Array.from(AUTH_ROUTES).some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  if (hide) {
    return null;
  }

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border/70 bg-background/[0.86] px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-6 md:h-14 md:justify-end md:pt-0">
      <Link
        aria-label="Go to jobs"
        className="flex min-w-0 items-center rounded-[14px] py-2 pr-2 transition hover:bg-card md:hidden"
        href="/jobs"
      >
        <BrandLogo
          iconClassName="size-8"
          textClassName="max-w-[10rem] text-sm text-foreground"
        />
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {user ? (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    aria-label={
                      unreadNotificationCount > 0
                        ? `Notifications, ${unreadNotificationCount} unread`
                        : "Notifications"
                    }
                    className="relative inline-flex size-9 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground outline-none transition hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                    href="/notifications"
                  >
                    <Bell className="size-4" />
                    {unreadNotificationCount > 0 ? (
                      <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-primary text-[9px] font-semibold leading-none text-primary-foreground">
                        {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                      </span>
                    ) : null}
                  </Link>
                }
              />
              <TooltipContent>
                {unreadNotificationCount > 0
                  ? `${unreadNotificationCount} unread notifications`
                  : "Notifications"}
              </TooltipContent>
            </Tooltip>
            <UserMenu user={user} />
            <MobileNavSheet />
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              className="rounded-[12px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground"
              href="/sign-in"
            >
              Sign in
            </Link>
            <Link
              className="rounded-[12px] bg-foreground px-3 py-1.5 text-sm font-medium text-background shadow-[0_1px_1px_rgba(0,0,0,0.12)] hover:opacity-90"
              href="/sign-up"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
