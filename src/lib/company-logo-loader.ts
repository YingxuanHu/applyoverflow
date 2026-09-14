import { normalizeCompanyLogoDomain } from "@/lib/company-logo";
import { createHash } from "node:crypto";

export const COMPANY_LOGO_MAX_BYTES = 32 * 1024;
export const COMPANY_LOGO_CACHE_ENTRIES = 128;
const DAY = 86_400_000;
type Logo = { bytes: Uint8Array; contentType: string };

function rasterType(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return "image/png";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)
    return "image/x-icon";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  return null;
}

export function createCompanyLogoLoader(
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  const cache = new Map<string, { value: Logo | null; expiresAt: number }>();
  const pending = new Map<string, Promise<Logo | null>>();

  async function downloadUrl(url: string): Promise<Logo | null> {
    try {
      // Fixed upstream, no redirects, credentials, visitor IP, referrer, or Next disk cache.
      const response = await fetcher(url, {
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(4000),
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get("content-length")) > COMPANY_LOGO_MAX_BYTES
      ) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > COMPANY_LOGO_MAX_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const contentType = rasterType(bytes);
      // Google's missing-domain response is normally 404. Reject its generic
      // globe even if a cached upstream response incorrectly reports success.
      if (
        createHash("sha256").update(bytes).digest("hex") ===
        "59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda64"
      )
        return null;
      return contentType ? { bytes, contentType } : null;
    } catch {
      return null;
    }
  }

  async function download(domain: string) {
    return (
      (await downloadUrl(`https://icons.duckduckgo.com/ip3/${domain}.ico`)) ??
      (await downloadUrl(
        `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=32`,
      ))
    );
  }

  return async function load(value: string): Promise<Logo | null> {
    const domain = normalizeCompanyLogoDomain(value);
    if (!domain) return null;
    const hit = cache.get(domain);
    if (hit && hit.expiresAt > now()) {
      cache.delete(domain);
      cache.set(domain, hit);
      return hit.value;
    }
    if (pending.has(domain)) return pending.get(domain)!;
    // A page can contain 50 different companies. Bound simultaneous misses too.
    if (pending.size >= 64) return null;
    const request = download(domain)
      .then((logo) => {
        cache.delete(domain);
        if (cache.size >= COMPANY_LOGO_CACHE_ENTRIES)
          cache.delete(cache.keys().next().value!);
        cache.set(domain, {
          value: logo,
          expiresAt: now() + (logo ? DAY : 60 * 60_000),
        });
        return logo;
      })
      .finally(() => pending.delete(domain));
    pending.set(domain, request);
    return request;
  };
}

export const loadCompanyLogo = createCompanyLogoLoader();
