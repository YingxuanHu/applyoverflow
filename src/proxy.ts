import { NextResponse, type NextRequest } from "next/server";

import {
  getAuthSecret,
  getVerifiedSessionTokenFromHeaders,
  hasPotentialSessionCookie,
  isSessionUsableByPolicy,
} from "@/lib/auth-session-policy";
import { prisma, withPrismaConnectionRetry } from "@/lib/db";
import { addReportOnlyCsp } from "@/lib/content-security-policy";
import {
  ServiceUnavailableError,
  serviceUnavailablePageResponse,
  serviceUnavailableResponse,
  withServiceAvailability,
} from "@/lib/service-availability";

const PROTECTED_ROUTE_PREFIXES = [
  "/jobs",
  "/saved",
  "/applications",
  "/dashboard",
  "/notifications",
  "/documents",
  "/profile",
  "/settings",
  "/account",
  "/ops",
  "/onboarding",
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
  if (!getAuthSecret()) {
    throw new ServiceUnavailableError(new Error("Session verification is not configured."));
  }

  const token = await getVerifiedSessionTokenFromHeaders(request.headers);
  if (!token) {
    return false;
  }

  const session = await withServiceAvailability(() => withPrismaConnectionRetry(() =>
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
  ));

  return Boolean(
    session?.userId &&
      isSessionUsableByPolicy(session) &&
      session.user.status === "ACTIVE"
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Setup actions enforce their own authentication and return a recoverable
  // session error. Redirecting their POST would discard the open editor.
  const setupAction = pathname === "/onboarding" && request.method === "POST" && request.headers.has("next-action");
  const finish = (response: NextResponse) => {
    addReportOnlyCsp(response.headers);
    return response;
  };
  try {
    if (isProtectedRoute(pathname) && !setupAction && !(await hasValidSession(request))) {
      const signInUrl = new URL("/", request.url);
      signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
      return finish(NextResponse.redirect(signInUrl));
    }
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    console.error("[proxy] SERVICE_UNAVAILABLE");
    const documentRequest = (request.method === "GET" || request.method === "HEAD") &&
      !request.headers.has("rsc") && request.headers.get("accept")?.includes("text/html");
    return finish(documentRequest ? serviceUnavailablePageResponse() : serviceUnavailableResponse());
  }

  return finish(NextResponse.next());
}

export const config = {
  matcher: [
    // Public documents also receive the observation policy. Auth checks above
    // still apply only to protected pages, including their prefetch requests.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
