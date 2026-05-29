export function parseOpsAdminEmails(rawValue: string | undefined | null) {
  return new Set(
    String(rawValue ?? "")
      .split(/[,\n]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isOpsAdminEmail(
  email: string | null | undefined,
  rawAllowlist = process.env.OPS_ADMIN_EMAILS
) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  return parseOpsAdminEmails(rawAllowlist).has(normalizedEmail);
}
