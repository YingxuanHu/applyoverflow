import { parseOpsAdminEmails } from "@/lib/ops-admin";

export function parseAiAllowedEmails(rawValue: string | undefined | null) {
  return new Set(
    String(rawValue ?? "")
      .split(/[,\n]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Cost-safe gate for OpenAI-spending AI features.
 *
 * Resolution order:
 * 1. If AI_ALLOWED_EMAILS is set/non-empty, allow only those emails.
 * 2. Otherwise fall back to OPS_ADMIN_EMAILS so owners/admins keep AI.
 * 3. If both are empty, DENY — nobody spends until an allowlist exists.
 *
 * The env values are injectable via `opts` for testing.
 */
export function isAiFeatureAllowed(
  email: string | null | undefined,
  opts: {
    aiAllowlist?: string | null;
    opsAllowlist?: string | null;
  } = {}
) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const aiAllowlist = parseAiAllowedEmails(
    opts.aiAllowlist ?? process.env.AI_ALLOWED_EMAILS
  );
  if (aiAllowlist.size > 0) {
    return aiAllowlist.has(normalizedEmail);
  }

  const opsAllowlist = parseOpsAdminEmails(
    opts.opsAllowlist ?? process.env.OPS_ADMIN_EMAILS
  );
  if (opsAllowlist.size > 0) {
    return opsAllowlist.has(normalizedEmail);
  }

  return false;
}
