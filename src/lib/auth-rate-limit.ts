type AuthRateLimitRule = {
  limit: number;
  windowMs: number;
};

type AuthRateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, AuthRateLimitBucket>();
const MAX_AUTH_RATE_LIMIT_BUCKETS = 10000;

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip") ??
    forwardedFor ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function consumeAuthRateLimit(
  request: Request,
  action: string,
  rule: AuthRateLimitRule
) {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const key = `${action}:${getClientIp(request)}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= rule.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  buckets.set(key, current);

  return { allowed: true, retryAfterSeconds: 0 };
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < MAX_AUTH_RATE_LIMIT_BUCKETS) {
    return;
  }

  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(bucketKey);
    }
  }

  if (buckets.size < MAX_AUTH_RATE_LIMIT_BUCKETS) {
    return;
  }

  const overflow = buckets.size - MAX_AUTH_RATE_LIMIT_BUCKETS;
  let deleted = 0;
  for (const bucketKey of buckets.keys()) {
    buckets.delete(bucketKey);
    deleted += 1;
    if (deleted >= overflow) {
      break;
    }
  }
}
