import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFetchTargetAllowed,
  fetchGuarded,
  isDisallowedFetchHost,
  isDisallowedIpAddress,
  SsrfBlockedError,
  type ResolvedAddress,
} from "@/lib/ingestion/net/ssrf-guard";

const resolveTo = (address: string, family = address.includes(":") ? 6 : 4) =>
  async (): Promise<ResolvedAddress[]> => [{ address, family }];

test("isDisallowedIpAddress blocks IPv4 loopback/private/link-local/CGNAT/unspecified", () => {
  for (const ip of [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
  ]) {
    assert.equal(isDisallowedIpAddress(ip), true, ip);
  }
});

test("isDisallowedIpAddress blocks IPv6 loopback/ULA/link-local/IPv4-mapped/unspecified", () => {
  for (const ip of [
    "::1",
    "fc00::",
    "fd12:3456:789a::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1", // ::ffff:127.0.0.1 in the hex form Node's URL parser emits
    "::",
    "[::1]",
  ]) {
    assert.equal(isDisallowedIpAddress(ip), true, ip);
  }
});

test("isDisallowedIpAddress allows public IPs and honors range boundaries", () => {
  for (const ip of [
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1", // just below 172.16/12
    "172.32.0.1", // just above 172.16/12
    "100.63.255.255", // just below 100.64/10
    "100.128.0.1", // just above 100.64/10
    "2606:2800:220:1:248:1893:25c8:1946",
  ]) {
    assert.equal(isDisallowedIpAddress(ip), false, ip);
  }
});

test("isDisallowedFetchHost blocks internal hostnames", () => {
  for (const host of [
    "localhost",
    "LOCALHOST",
    "app.localhost",
    "foo.local",
    "MyServer.local",
    "svc.internal",
    "metadata",
    "metadata.google.internal",
    "localhost.", // trailing-dot FQDN form
  ]) {
    assert.equal(isDisallowedFetchHost(host), true, host);
  }
});

test("isDisallowedFetchHost allows public hostnames", () => {
  for (const host of [
    "example.com",
    "jobs.lever.co",
    "boards.greenhouse.io",
    "careers.acme.io",
  ]) {
    assert.equal(isDisallowedFetchHost(host), false, host);
  }
});

test("assertFetchTargetAllowed rejects non-http(s) schemes", async () => {
  await assert.rejects(
    () => assertFetchTargetAllowed("file:///etc/passwd"),
    SsrfBlockedError
  );
  await assert.rejects(
    () => assertFetchTargetAllowed("ftp://example.com/x", { resolve: resolveTo("8.8.8.8") }),
    SsrfBlockedError
  );
});

test("assertFetchTargetAllowed rejects disallowed hostnames without resolving", async () => {
  let resolverCalled = false;
  const resolve = async (): Promise<ResolvedAddress[]> => {
    resolverCalled = true;
    return [{ address: "8.8.8.8", family: 4 }];
  };
  await assert.rejects(
    () => assertFetchTargetAllowed("http://localhost:8080/admin", { resolve }),
    SsrfBlockedError
  );
  assert.equal(resolverCalled, false);
});

test("assertFetchTargetAllowed rejects disallowed IP literals", async () => {
  await assert.rejects(
    () => assertFetchTargetAllowed("http://169.254.169.254/latest/meta-data/"),
    SsrfBlockedError
  );
  await assert.rejects(
    () => assertFetchTargetAllowed("http://[::1]:9200/"),
    SsrfBlockedError
  );
});

test("assertFetchTargetAllowed allows a public host resolving to a public IP", async () => {
  await assert.doesNotReject(
    assertFetchTargetAllowed("https://example.com/careers", {
      resolve: resolveTo("93.184.216.34"),
    })
  );
});

test("assertFetchTargetAllowed rejects a public hostname that resolves to a private IP", async () => {
  await assert.rejects(
    () =>
      assertFetchTargetAllowed("http://internal.example.com/", {
        resolve: resolveTo("10.0.0.5"),
      }),
    SsrfBlockedError
  );
});

test("assertFetchTargetAllowed rejects when ANY resolved address is private", async () => {
  const resolve = async (): Promise<ResolvedAddress[]> => [
    { address: "93.184.216.34", family: 4 },
    { address: "169.254.169.254", family: 4 },
  ];
  await assert.rejects(
    () => assertFetchTargetAllowed("http://mixed.example.com/", { resolve }),
    SsrfBlockedError
  );
});

test("fetchGuarded blocks a redirect to an internal host", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("/start")) {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }
    return new Response("should not reach here", { status: 200 });
  }) as typeof fetch;

  await assert.rejects(
    () =>
      fetchGuarded(
        "http://example.com/start",
        {},
        { resolve: resolveTo("93.184.216.34"), fetchImpl }
      ),
    SsrfBlockedError
  );
  // The guard fetched the initial URL, then blocked before fetching the metadata host.
  assert.deepEqual(seen, ["http://example.com/start"]);
});

test("fetchGuarded returns the final response after allowed redirects", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/start")) {
      return new Response(null, {
        status: 301,
        headers: { location: "https://example.com/final" },
      });
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  const response = await fetchGuarded(
    "https://example.com/start",
    {},
    { resolve: resolveTo("93.184.216.34"), fetchImpl }
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});
