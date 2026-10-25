import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("A strong BETTER_AUTH_SECRET is required for announcement unsubscribe links");
  return value;
}

// Purpose-bound, opaque subscriber ID. No email addresses in URLs, no expiry that
// could prevent someone unsubscribing from an older message.
export function productUnsubscribeToken(userId: string) {
  const payload = Buffer.from(userId).toString("base64url");
  const signature = createHmac("sha256", secret()).update(`product-updates:v1:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function readProductUnsubscribeToken(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,256}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", secret()).update(`product-updates:v1:${payload}`).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  return Buffer.from(payload, "base64url").toString("utf8") || null;
}
