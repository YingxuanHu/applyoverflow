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
  return (
    firstConfiguredUrl(
      process.env.BETTER_AUTH_URL,
      process.env.APP_URL,
      process.env.HETZNER_APP_URL,
      process.env.NEXT_PUBLIC_BETTER_AUTH_URL
    ) ?? "http://localhost:3000"
  );
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
    if (value) {
      origins.add(value);
    }
  }

  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");
  origins.add("http://localhost:3001");
  origins.add("http://127.0.0.1:3001");
  origins.add("http://localhost:3002");
  origins.add("http://127.0.0.1:3002");
  origins.add("http://localhost:3003");
  origins.add("http://127.0.0.1:3003");
  origins.add("http://localhost:3004");
  origins.add("http://127.0.0.1:3004");

  return [...origins];
}
