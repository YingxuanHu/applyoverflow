export const CSP_REPORT_PATH = "/api/security/csp-report";
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const CSP_REPORT_MAX_BATCH = 10;
export const CSP_REPORT_TIMEOUT_MS = 2_000;
export const CSP_REPORT_REQUESTS_PER_MINUTE = 60;

// Observation only. Inline framework/theme scripts and styles need a separate
// nonce/hash rollout and browser verification before this can be enforced.
export const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `report-uri ${CSP_REPORT_PATH}`,
  "report-to csp",
].join("; ");

export function addReportOnlyCsp(headers: Headers) {
  if (process.env.NODE_ENV !== "production") return;
  headers.set("Content-Security-Policy-Report-Only", REPORT_ONLY_CSP);
  // Relative to this site's origin; never reflect Host or URL parameters.
  headers.set("Reporting-Endpoints", `csp="${CSP_REPORT_PATH}"`);
}

const DIRECTIVES = new Set([
  "default-src", "script-src", "script-src-elem", "script-src-attr",
  "style-src", "style-src-elem", "style-src-attr", "img-src", "font-src",
  "connect-src", "frame-src", "child-src", "worker-src", "media-src",
  "manifest-src", "object-src", "base-uri", "form-action", "frame-ancestors",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function resourceCategory(value: unknown) {
  if (value === "inline" || value === "eval") return value;
  if (typeof value !== "string" || !value) return "unknown";
  if (value.startsWith("data:")) return "data";
  if (value.startsWith("blob:")) return "blob";
  if (/^https?:\/\//i.test(value)) return "network";
  return "other";
}

export function summarizeCspReports(input: unknown) {
  const reports = Array.isArray(input) ? input : [input];
  if (!reports.length || reports.length > CSP_REPORT_MAX_BATCH) return null;
  const summaries: { directive: string; resource: string; disposition: "report" }[] = [];
  for (const value of reports) {
    const report = record(value);
    const legacy = record(report?.["csp-report"]);
    const body = legacy ?? (report?.type === "csp-violation" ? record(report.body) : null);
    if (!body || (body.disposition !== undefined && body.disposition !== "report")) continue;
    const directive = body[legacy ? "effective-directive" : "effectiveDirective"];
    if (typeof directive !== "string" || !DIRECTIVES.has(directive)) continue;
    // Discard document/referrer/source/blocked URLs, samples, line numbers,
    // policies, user agents and all unknown fields. Never spread report input.
    summaries.push({ directive, resource: resourceCategory(body[legacy ? "blocked-uri" : "blockedURL"]), disposition: "report" });
  }
  return summaries;
}
