import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";

const claimsSchema = z.object({
  purpose: z.literal("application-workspace-v1"),
  userId: z.string().min(1),
  applicationId: z.string().min(1),
  url: z.string().url(),
  expires: z.number().int(),
  nonce: z.string().uuid(),
}).strict();
export type WorkspaceClaims = z.infer<typeof claimsSchema>;

export function issueWorkspaceToken(input: Pick<WorkspaceClaims, "userId" | "applicationId" | "url">, secret: string, now = Date.now()) {
  const claims = claimsSchema.parse({ ...input, purpose: "application-workspace-v1", expires: now + 30 * 60_000, nonce: randomUUID() });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expires: claims.expires };
}

export function verifyWorkspaceToken(token: string, secret: string, userId: string, now = Date.now()): WorkspaceClaims | null {
  if (token.length > 6000) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  const received = Buffer.from(parts[1], "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
    return claims.userId === userId && claims.expires > now && claims.expires <= now + 30 * 60_000 ? claims : null;
  } catch { return null; }
}
