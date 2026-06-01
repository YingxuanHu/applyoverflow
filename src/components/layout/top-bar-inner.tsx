"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandLogo } from "@/components/brand/brand-logo";
import { MobileNavSheet } from "@/components/layout/mobile-nav-sheet";
import { UserMenu } from "@/components/layout/user-menu";

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
  user,
}: {
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
