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
  // Our Caddy edge overwrites X-Real-IP with the real TCP peer and strips
  // client-supplied forwarding headers, so it is the only trustworthy source.
  // As a fallback (e.g. direct/dev access) use the RIGHTMOST X-Forwarded-For
  // entry — the value the last trusted proxy appended — never the leftmost,
  // client-controllable value or cf-connecting-ip (there is no Cloudflare here).
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
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
