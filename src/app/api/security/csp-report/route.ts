import { parseJsonBodyWithLimit } from "@/lib/api-utils";
import {
  CSP_REPORT_MAX_BYTES,
  CSP_REPORT_REQUESTS_PER_MINUTE,
  CSP_REPORT_TIMEOUT_MS,
  summarizeCspReports,
} from "@/lib/content-security-policy";

// A fixed process-wide budget bounds parsing/log volume without retaining IPs
// or attacker-controlled bucket keys. Edge/distributed limits are still needed.
let windowStart = 0;
let requests = 0;

function response(status: number) {
  return new Response(null, { status, headers: {
    "Cache-Control": "no-store",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
}

export async function POST(request: Request) {
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; requests = 0; }
  if (++requests > CSP_REPORT_REQUESTS_PER_MINUTE) return response(429);

  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/csp-report" && contentType !== "application/reports+json") return response(415);
  if (request.headers.get("sec-fetch-site") === "cross-site") return response(403);

  try {
    const body = await parseJsonBodyWithLimit(request, CSP_REPORT_MAX_BYTES, "CSP report", "Invalid report", { timeoutMs: CSP_REPORT_TIMEOUT_MS });
    if (!body.ok) return response(body.response.status);
    const summaries = summarizeCspReports(body.data);
    if (!summaries) return response(400);
    if (summaries.length) console.info("[security.csp.report-only]", summaries);
    return response(204);
  } catch {
    // Malformed/disconnected browser reports are not application exceptions.
    return response(400);
  }
}
