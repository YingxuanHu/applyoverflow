import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { rateLimitResponse } from "@/lib/api-utils";
import { normalizeCompanyLogoDomain } from "@/lib/company-logo";
import { loadCompanyLogo } from "@/lib/company-logo-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const domain = normalizeCompanyLogoDomain(
    new URL(request.url).searchParams.get("domain"),
  );
  if (!domain) return new Response(null, { status: 400 });
  const limited = await rateLimitResponse(
    request,
    "company-logo",
    API_RATE_LIMITS.publicRead,
  );
  if (limited) return limited;
  const logo = await loadCompanyLogo(domain);
  if (!logo)
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=300" },
    });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      "Content-Length": String(logo.bytes.byteLength),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
