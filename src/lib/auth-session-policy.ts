const DAY_SECONDS = 60 * 60 * 24;

export const SESSION_INACTIVITY_TIMEOUT_SECONDS = 7 * DAY_SECONDS;
export const SESSION_MAX_LIFETIME_SECONDS = 30 * DAY_SECONDS;
export const SENSITIVE_ACTION_REAUTH_SECONDS = DAY_SECONDS;
export const SESSION_REFRESH_INTERVAL_SECONDS = DAY_SECONDS;

export const AUTH_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

const LOCAL_DEV_AUTH_SECRET = "autoapplication-local-dev-auth-secret-2026";

export type SessionPolicyReason =
  | "expired"
  | "inactive"
  | "max_lifetime"
  | "not_fresh";

export type SessionPolicyRecord = {
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

export function getAuthSecret() {
  return process.env.BETTER_AUTH_SECRET ??
    (process.env.NODE_ENV !== "production" ? LOCAL_DEV_AUTH_SECRET : undefined);
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getCookieValue(headers: Headers, cookieName: string) {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(/;\s*/)) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex);
    if (name === cookieName) {
      return part.slice(separatorIndex + 1);
    }
  }

  return null;
}

export function hasPotentialSessionCookie(headers: Headers) {
  return AUTH_COOKIE_NAMES.some((name) => Boolean(getCookieValue(headers, name)));
}

export async function verifySignedCookieValue(value: string, secret: string) {
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

export async function getVerifiedSessionTokenFromHeaders(headers: Headers) {
  const secret = getAuthSecret();
  if (!secret) {
    return null;
  }

  for (const name of AUTH_COOKIE_NAMES) {
    const cookieValue = getCookieValue(headers, name);
    if (!cookieValue) {
      continue;
    }

    const token = await verifySignedCookieValue(cookieValue, secret);
    if (token) {
      return token;
    }
  }

  return null;
}

function ageSeconds(now: Date, value: Date) {
  return Math.floor((now.getTime() - value.getTime()) / 1000);
}

export function getSessionPolicyFailure(
  session: SessionPolicyRecord,
  now = new Date()
): SessionPolicyReason | null {
  if (session.expiresAt <= now) {
    return "expired";
  }

  if (ageSeconds(now, session.updatedAt) > SESSION_INACTIVITY_TIMEOUT_SECONDS) {
    return "inactive";
  }

  if (ageSeconds(now, session.createdAt) > SESSION_MAX_LIFETIME_SECONDS) {
    return "max_lifetime";
  }

  return null;
}

export function isSessionUsableByPolicy(session: SessionPolicyRecord, now = new Date()) {
  return getSessionPolicyFailure(session, now) === null;
}

export function getSensitiveActionSessionFailure(
  session: SessionPolicyRecord,
  now = new Date()
): SessionPolicyReason | null {
  const baseFailure = getSessionPolicyFailure(session, now);
  if (baseFailure) {
    return baseFailure;
  }

  if (ageSeconds(now, session.createdAt) > SENSITIVE_ACTION_REAUTH_SECONDS) {
    return "not_fresh";
  }

  return null;
}

export function isSessionFreshForSensitiveAction(
  session: SessionPolicyRecord,
  now = new Date()
) {
  return getSensitiveActionSessionFailure(session, now) === null;
}
