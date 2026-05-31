import { NextResponse, type NextRequest } from "next/server";

import { prisma, withPrismaConnectionRetry } from "@/lib/db";

const AUTH_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

const LOCAL_DEV_AUTH_SECRET = "autoapplication-local-dev-auth-secret-2026";

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

function hasPotentialSessionCookie(request: NextRequest) {
  return AUTH_COOKIE_NAMES.some((name) => Boolean(request.cookies.get(name)?.value));
}

function isProtectedRoute(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function getAuthSecret() {
  return process.env.BETTER_AUTH_SECRET ??
    (process.env.NODE_ENV !== "production" ? LOCAL_DEV_AUTH_SECRET : undefined);
}

function getPotentialSessionCookieValue(request: NextRequest) {
  for (const name of AUTH_COOKIE_NAMES) {
    const value = request.cookies.get(name)?.value;
    if (value) {
      return value;
    }
  }

  return null;
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function verifySignedCookieValue(value: string, secret: string) {
  const decodedValue = decodeCookieValue(value);
  const separatorIndex = decodedValue.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === decodedValue.length - 1) {
    return null;
  }

  const token = decodedValue.slice(0, separatorIndex);
  const signature = decodedValue.slice(separatorIndex + 1);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signatureBytes = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0));
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(token)
    );

    return isValid ? token : null;
  } catch {
    return null;
  }
}

async function getVerifiedSessionToken(request: NextRequest) {
  const cookieValue = getPotentialSessionCookieValue(request);
  const secret = getAuthSecret();
  if (!cookieValue || !secret) {
    return null;
  }

  return verifySignedCookieValue(cookieValue, secret);
}

async function hasValidSession(request: NextRequest) {
  if (!hasPotentialSessionCookie(request)) {
    return false;
  }

  const token = await getVerifiedSessionToken(request);
  if (!token) {
    return false;
  }

  const session = await withPrismaConnectionRetry(() =>
    prisma.session.findUnique({
      where: { token },
      select: {
        expiresAt: true,
        userId: true,
        user: {
          select: { status: true },
        },
      },
    })
  );

  return Boolean(
    session?.userId &&
      session.expiresAt > new Date() &&
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
