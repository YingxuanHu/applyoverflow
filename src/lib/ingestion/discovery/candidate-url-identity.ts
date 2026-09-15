import { normalizeUrlIdentityKey } from "@/lib/ingestion/source-quality";

// Posting identity and employer-board identity are different. ADP's employer
// and career-center IDs are required to distinguish boards on its shared host.
// Keep this discovery-only so existing canonical dedup keys do not change.
export function normalizeSourceCandidateUrlIdentityKey(input: string) {
  const base = normalizeUrlIdentityKey(input);
  if (base === null) return null;
  const url = new URL(input);
  if (![
    "workforcenow.adp.com",
    "workforcenow.cloud.adp.com",
  ].includes(url.hostname.toLowerCase()) || !/\/recruitment\.html$/i.test(url.pathname)) return base;

  const tenant = [...url.searchParams.entries()]
    .filter(([key, value]) => ["cid", "ccid"].includes(key.toLowerCase()) && value.trim())
    .map(([key, value]) => [key.toLowerCase(), value.trim().toLowerCase()])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return tenant.length ? `${base}${base.includes("?") ? "&" : "?"}${tenant.join("&")}` : base;
}
