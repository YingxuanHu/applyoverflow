type HeaderSource = {
  get(name: string): string | null;
};

function firstConfiguredUrl(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean);
}

/**
 * Resolve the application's canonical base URL from server configuration ONLY.
 *
 * This intentionally never reads request headers (Host / X-Forwarded-Host /
 * Origin). Deriving URLs from request headers lets an attacker who controls
 * those headers point server-generated links (password reset, email
 * verification) at their own host, so the origin must come from configured env.
 */
export function resolveCanonicalAppUrl() {
  const configured = firstConfiguredUrl(
    process.env.BETTER_AUTH_URL,
    process.env.APP_URL,
    process.env.HETZNER_APP_URL,
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL
  );
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Configure BETTER_AUTH_URL or APP_URL in production.");
  }
  return "http://localhost:3000";
}

/**
 * Build better-auth's trusted-origin allowlist from configured environment ONLY.
 *
 * Request-derived origins are intentionally NOT added: adding the request's own
 * Origin/Host would let a request authorize itself and defeat CSRF/redirect
 * validation. The `_headers` argument is accepted for call-site compatibility
 * but deliberately ignored.
 */
export function buildRuntimeTrustedOrigins(_headers?: HeaderSource | null) {
  void _headers;
  const origins = new Set<string>();

  for (const value of [
    process.env.BETTER_AUTH_URL,
    process.env.APP_URL,
    process.env.HETZNER_APP_URL,
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  ]) {
    if (value?.trim()) {
      const url = new URL(value.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hostname.includes("*")) {
        throw new Error("Trusted application URLs must be explicit HTTP(S) origins without credentials or wildcards.");
      }
      origins.add(url.origin);
    }
  }

  // Production-mode CI can still opt into one exact local origin via env.
  if (process.env.NODE_ENV !== "production") {
    for (const port of [3000, 3001, 3002, 3003, 3004]) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }

  return [...origins];
}
