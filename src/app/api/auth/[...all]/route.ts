import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { isPrismaConnectionClosedError, reconnectPrisma, withPrismaConnectionRetry } from "@/lib/db";

const authHandlers = toNextJsHandler(auth);

const AUTH_POST_RATE_LIMITS: Array<{
  pathIncludes: string[];
  action: string;
  limit: number;
  windowMs: number;
}> = [
  {
    pathIncludes: ["/sign-in", "/login"],
    action: "auth:sign-in",
    limit: 20,
    windowMs: 15 * 60_000,
  },
  {
    pathIncludes: ["/sign-up", "/register"],
    action: "auth:sign-up",
    limit: 10,
    windowMs: 60 * 60_000,
  },
  {
    pathIncludes: ["/change-email", "/verify-email", "/send-verification"],
    action: "auth:email-verification",
    limit: 10,
    windowMs: 15 * 60_000,
  },
  {
    pathIncludes: ["/delete-user", "/change-password"],
    action: "auth:sensitive-account-action",
    limit: 12,
    windowMs: 15 * 60_000,
  },
];

async function handleAuthRequest(
  handler: (request: Request) => Promise<Response>,
  request: Request
) {
  try {
    return await withPrismaConnectionRetry(() => handler(request));
  } catch (error) {
    if (!isPrismaConnectionClosedError(error)) {
      throw error;
    }

    await reconnectPrisma();
    return handler(request);
  }
}

export async function GET(request: Request) {
  return handleAuthRequest(authHandlers.GET, request);
}

export async function POST(request: Request) {
  const rateLimited = rateLimitAuthPost(request);
  if (rateLimited) {
    return rateLimited;
  }

  return handleAuthRequest(authHandlers.POST, request);
}

function rateLimitAuthPost(request: Request) {
  const pathname = new URL(request.url).pathname.toLowerCase();
  const rule = AUTH_POST_RATE_LIMITS.find((candidate) =>
    candidate.pathIncludes.some((part) => pathname.includes(part))
  );

  if (!rule) {
    return null;
  }

  const result = consumeAuthRateLimit(request, rule.action, {
    limit: rule.limit,
    windowMs: rule.windowMs,
  });

  if (result.allowed) {
    return null;
  }

  return Response.json(
    { error: "Too many requests. Try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    }
  );
}
