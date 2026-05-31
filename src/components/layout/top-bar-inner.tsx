"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 border-b border-border/70 bg-background/[0.82] px-4 backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-2">
        {user ? (
          <UserMenu user={user} />
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
