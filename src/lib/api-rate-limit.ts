import { NextResponse } from "next/server";

import { getOptionalCurrentAuthUserId } from "@/lib/current-user";

type RateLimitScope = "user-or-ip" | "ip";

export type ApiRateLimitRule = {
  limit: number;
  windowMs: number;
  scope?: RateLimitScope;
};

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20000;

export const API_RATE_LIMITS = {
  publicRead: { limit: 240, windowMs: 60_000, scope: "ip" },
  authenticatedWrite: { limit: 120, windowMs: 60_000, scope: "user-or-ip" },
  aiAnalyze: { limit: 20, windowMs: 60 * 60_000, scope: "user-or-ip" },
  aiCoverLetter: { limit: 10, windowMs: 60 * 60_000, scope: "user-or-ip" },
  aiAssistant: { limit: 60, windowMs: 60 * 60_000, scope: "user-or-ip" },
  aiTailoredResume: { limit: 6, windowMs: 60 * 60_000, scope: "user-or-ip" },
  naturalLanguageJobSearch: { limit: 60, windowMs: 60_000, scope: "user-or-ip" },
  documentUpload: { limit: 20, windowMs: 60 * 60_000, scope: "user-or-ip" },
  documentSync: { limit: 30, windowMs: 60 * 60_000, scope: "user-or-ip" },
  documentDownload: { limit: 120, windowMs: 60_000, scope: "user-or-ip" },
  dataExport: { limit: 6, windowMs: 60 * 60_000, scope: "user-or-ip" },
} satisfies Record<string, ApiRateLimitRule>;

export async function enforceApiRateLimit(
  request: Request,
  action: string,
  rule: ApiRateLimitRule
) {
  const result = await consumeApiRateLimit(request, action, rule);

  if (result.allowed) {
    return null;
  }

  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    {
      status: 429,
      headers: rateLimitHeaders(result),
    }
  );
}

async function consumeApiRateLimit(
  request: Request,
  action: string,
  rule: ApiRateLimitRule
): Promise<RateLimitResult> {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const scope = rule.scope ?? "user-or-ip";
  const userId =
    scope === "user-or-ip"
      ? await getOptionalCurrentAuthUserId().catch(() => null)
      : null;
  const identity = userId ? `user:${userId}` : `ip:${getClientIp(request)}`;
  const key = `${action}:${identity}`;
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + rule.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(rule.limit - bucket.count, 0);
  const retryAfterSeconds = Math.max(
    Math.ceil((bucket.resetAt - now) / 1000),
    1
  );

  return {
    allowed: bucket.count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds,
  };
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < MAX_BUCKETS) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  if (buckets.size < MAX_BUCKETS) {
    return;
  }

  const overflow = buckets.size - MAX_BUCKETS;
  let deleted = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    deleted += 1;
    if (deleted >= overflow) {
      break;
    }
  }
}

function rateLimitHeaders(result: RateLimitResult) {
  return {
    "Retry-After": String(result.retryAfterSeconds),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

function getClientIp(request: Request) {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}
