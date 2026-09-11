export const LOCAL_DEVELOPMENT_ADMIN = {
  email: "admin@applyoverflow.local",
  name: "Local Admin",
  password: "password",
  username: "admin",
} as const;

type AuthEnvironment = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalDevelopmentAuthEnabled(environment: AuthEnvironment = process.env) {
  if (environment.NODE_ENV === "production") {
    return false;
  }

  const appUrl =
    environment.BETTER_AUTH_URL ??
    environment.APP_URL ??
    environment.NEXT_PUBLIC_BETTER_AUTH_URL ??
    "http://localhost:3000";

  try {
    return LOOPBACK_HOSTS.has(new URL(appUrl).hostname);
  } catch {
    return false;
  }
}

export function isLocalDevelopmentDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) return false;

  try {
    const url = new URL(databaseUrl);
    return LOOPBACK_HOSTS.has(url.hostname) && (!url.port || url.port === "5432");
  } catch {
    return false;
  }
}
