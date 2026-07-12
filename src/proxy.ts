import { NextResponse, type NextRequest } from "next/server";

import {
  getVerifiedSessionTokenFromHeaders,
  hasPotentialSessionCookie,
  isSessionUsableByPolicy,
} from "@/lib/auth-session-policy";
import { prisma, withPrismaConnectionRetry } from "@/lib/db";

const PROTECTED_ROUTE_PREFIXES = [
  "/jobs",
  "/saved",
  "/applications",
  "/dashboard",
  "/notifications",
  "/documents/compare",
  "/profile",
  "/settings",
  "/account",
  "/ops",
] as const;

function isProtectedRoute(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

async function hasValidSession(request: NextRequest) {
  if (!hasPotentialSessionCookie(request.headers)) {
    return false;
  }

  const token = await getVerifiedSessionTokenFromHeaders(request.headers);
  if (!token) {
    return false;
  }

  const session = await withPrismaConnectionRetry(() =>
    prisma.session.findUnique({
      where: { token },
      select: {
        createdAt: true,
        expiresAt: true,
        updatedAt: true,
        userId: true,
        user: {
          select: { status: true },
        },
      },
    })
  );

  return Boolean(
    session?.userId &&
      isSessionUsableByPolicy(session) &&
      session.user.status === "ACTIVE"
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isProtectedRoute(pathname) && !(await hasValidSession(request))) {
    const signInUrl = new URL("/", request.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/jobs/:path*",
    "/saved/:path*",
    "/applications/:path*",
    "/dashboard/:path*",
    "/notifications/:path*",
    "/documents/compare/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/account/:path*",
    "/ops/:path*",
  ],
};
