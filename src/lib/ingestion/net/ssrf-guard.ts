/**
 * SSRF guard for arbitrary-URL outbound fetches.
 *
 * The discovery registry and company-site crawler fetch attacker-influenced
 * URLs (career pages found via search, links scraped from HTML). On a cloud
 * VPS an unguarded fetch to such a URL can reach the instance metadata service
 * (169.254.169.254 / IMDS) or other internal hosts — including via a redirect
 * to an internal host or a public hostname that resolves to a private IP.
 *
 * This module blocks those targets before the request leaves the process:
 *   - non-http(s) schemes are refused outright,
 *   - disallowed hostnames (localhost, *.local, metadata) are refused,
 *   - the hostname is resolved via DNS and every resolved address is checked,
 *   - `fetchGuarded` follows redirects manually and re-validates each hop.
 *
 * DNS + fetch are injectable so tests can exercise the resolve-to-private and
 * redirect-to-internal paths without real network access.
 */
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECT_HOPS = 5;

/** Shape returned by `node:dns/promises` `lookup(host, { all: true })`. */
export type ResolvedAddress = { address: string; family: number };
export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type FetchImpl = typeof fetch;

export type FetchGuardDeps = {
  /** Injectable DNS resolver (defaults to node:dns/promises lookup all). */
  resolve?: DnsResolver;
  /** Injectable fetch implementation (defaults to global fetch). */
  fetchImpl?: FetchImpl;
};

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const DISALLOWED_EXACT_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

/**
 * Blocks hostnames that are inherently local/internal regardless of DNS:
 * localhost (and subdomains), *.local mDNS names, *.internal, and the
 * well-known cloud metadata hostnames.
 */
export function isDisallowedFetchHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (DISALLOWED_EXACT_HOSTNAMES.has(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".internal")) return true;
  return false;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isDisallowedIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 (includes 0.0.0.0)
  if (a === 127) return true; // loopback 127/8
  if (a === 10) return true; // private 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 169 && b === 254) return true; // link-local 169.254/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast and reserved
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return false;
}

/**
 * Parse an IPv6 literal (with optional zone id and embedded IPv4 tail) into
 * eight 16-bit groups, or null if it is not a valid IPv6 address.
 */
function parseIpv6(ip: string): number[] | null {
  let text = ip;
  const zoneIndex = text.indexOf("%");
  if (zoneIndex >= 0) text = text.slice(0, zoneIndex);
  if (!text.includes(":")) return null;

  // Rewrite an embedded IPv4 tail (e.g. ::ffff:127.0.0.1) into two hextets so
  // the rest of the parser only has to deal with hex groups.
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const seg of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
      out.push(parseInt(seg, 16));
    }
    return out;
  };

  if (halves.length === 2) {
    const head = parseGroups(halves[0]);
    const tail = parseGroups(halves[1]);
    if (!head || !tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
  }

  const groups = parseGroups(text);
  if (!groups || groups.length !== 8) return null;
  return groups;
}

function isDisallowedIpv6(groups: number[]): boolean {
  if (groups.every((g) => g === 0)) return true; // unspecified ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // loopback ::1
  if (((groups[0] >> 8) & 0xfe) === 0xfc) return true; // unique-local fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): validate the
  // embedded IPv4 against the IPv4 rules so mapped internal addresses are caught.
  const firstFiveZero = groups.slice(0, 5).every((g) => g === 0);
  if (firstFiveZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const v4 = [
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff,
    ];
    if (isDisallowedIpv4(v4)) return true;
  }
  return false;
}

/**
 * True when `ip` is a loopback/private/link-local/CGNAT/unspecified address
 * (IPv4 or IPv6, including IPv4-mapped IPv6). Non-IP strings return false —
 * hostnames are handled by isDisallowedFetchHost + DNS resolution instead.
 */
export function isDisallowedIpAddress(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!raw) return true;
  const ipv4 = parseIpv4(raw);
  if (ipv4) return isDisallowedIpv4(ipv4);
  const groups = parseIpv6(raw);
  if (groups) return isDisallowedIpv6(groups);
  return false;
}

function looksLikeIpLiteral(host: string): boolean {
  return parseIpv4(host) !== null || parseIpv6(host) !== null;
}

const defaultResolve: DnsResolver = (hostname) => lookup(hostname, { all: true });

export function createPinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  const approved = addresses.map((address) => ({ ...address }));
  if (!approved.length || approved.some(({ address }) => !isIP(address) || isDisallowedIpAddress(address))) {
    throw new SsrfBlockedError("No approved outbound address");
  }
  return (_hostname, options, callback) => {
    const address = approved[0];
    if (options.all) callback(null, approved);
    else callback(null, address.address, address.family);
  };
}

/**
 * Reject before fetching if the URL is not http(s), targets a disallowed host,
 * is a disallowed IP literal, or resolves (via DNS) to any disallowed address.
 */
export async function assertFetchTargetAllowed(
  url: string | URL,
  deps: FetchGuardDeps = {}
): Promise<ResolvedAddress[]> {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    throw new SsrfBlockedError(`Refusing to fetch malformed URL: ${String(url)}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(
      `Refusing to fetch non-http(s) URL: ${parsed.protocol}//`
    );
  }

  if (parsed.username || parsed.password || (parsed.port && !["80", "443"].includes(parsed.port))) {
    throw new SsrfBlockedError("Refusing URL credentials or an unexpected outbound port");
  }

  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (isDisallowedFetchHost(hostname)) {
    throw new SsrfBlockedError(`Refusing to fetch disallowed host: ${hostname}`);
  }

  if (looksLikeIpLiteral(hostname)) {
    if (isDisallowedIpAddress(hostname)) {
      throw new SsrfBlockedError(`Refusing to fetch disallowed IP: ${hostname}`);
    }
    return [{ address: hostname, family: isIP(hostname) }];
  }

  const resolve = deps.resolve ?? defaultResolve;
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new SsrfBlockedError(
      `Refusing to fetch host that failed to resolve: ${hostname}`
    );
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(
      `Refusing to fetch host with no resolved addresses: ${hostname}`
    );
  }

  for (const { address } of addresses) {
    if (!isIP(address) || isDisallowedIpAddress(address)) {
      throw new SsrfBlockedError(
        `Refusing to fetch host resolving to disallowed IP: ${hostname} -> ${address}`
      );
    }
  }
  return addresses;
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * SSRF-safe fetch wrapper: validates the target (and every redirect hop) before
 * the request leaves the process, follows redirects manually so an internal
 * redirect target is caught, and applies a default timeout when the caller does
 * not supply its own AbortSignal.
 */
export async function fetchGuarded(
  url: string,
  init: RequestInit = {},
  deps: FetchGuardDeps = {}
): Promise<Response> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    ...(init.signal ? [init.signal] : []),
  ]);
  const requestHeaders = new Headers(init.headers);
  requestHeaders.delete("host");

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      signal.throwIfAborted();
      const addresses = await assertFetchTargetAllowed(currentUrl, deps);
      signal.throwIfAborted();
      const dispatcher = new Agent({
        connect: {
          lookup: createPinnedLookup(addresses),
        },
        headersTimeout: DEFAULT_FETCH_TIMEOUT_MS,
        bodyTimeout: DEFAULT_FETCH_TIMEOUT_MS,
      });
      let response: Response;
      try {
        // The URL retains its hostname for Host and TLS verification; only the
        // socket's DNS lookup is replaced with the already-approved addresses.
        const fetchImpl = deps.fetchImpl ?? fetch;
        response = await fetchImpl(currentUrl, {
          ...init,
          headers: requestHeaders,
          signal,
          redirect: "manual",
          dispatcher,
        } as RequestInit & { dispatcher: Agent }) as Response;
      } finally {
        // Graceful close waits for the response body; do not await it before
        // returning that body to the caller.
        void dispatcher.close().catch(() => dispatcher.destroy());
      }

      if (!isRedirectStatus(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location) {
        return response;
      }

      if (hop === MAX_REDIRECT_HOPS) {
        throw new SsrfBlockedError(
          `Refusing to follow more than ${MAX_REDIRECT_HOPS} redirects for ${url}`
        );
      }

      await response.body?.cancel();
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== new URL(currentUrl).origin) {
        requestHeaders.delete("authorization");
        requestHeaders.delete("cookie");
      }
      currentUrl = nextUrl.toString();
    }

    // Unreachable: the loop either returns a response or throws.
    throw new SsrfBlockedError(
      `Refusing to follow more than ${MAX_REDIRECT_HOPS} redirects for ${url}`
    );
  } finally {
    // AbortSignal.timeout also bounds body consumption after headers return.
  }
}
