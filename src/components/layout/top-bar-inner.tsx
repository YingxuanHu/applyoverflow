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
    <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-sm sm:px-6">
      <div className="flex items-center gap-2">
        {user ? (
          <UserMenu user={user} />
        ) : (
          <div className="flex items-center gap-2">
            <Link
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              href="/sign-in"
            >
              Sign in
            </Link>
            <Link
              className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
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
