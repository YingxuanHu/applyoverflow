import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPANY_LOGO_IDENTITIES } from "../src/lib/company-logo-identities";
import {
  companyInitials,
  normalizeCompanyLogoDomain,
  resolveCompanyLogoDomain,
} from "../src/lib/company-logo";
import {
  COMPANY_LOGO_CACHE_ENTRIES,
  COMPANY_LOGO_MAX_BYTES,
  createCompanyLogoLoader,
} from "../src/lib/company-logo-loader";

const icon = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
test("logos normalize recorded domains but reject private names, IPs and shared job hosts", () => {
  assert.equal(
    normalizeCompanyLogoDomain("https://www.Stripe.com/"),
    "stripe.com",
  );
  assert.equal(normalizeCompanyLogoDomain("openai.com"), "openai.com");
  for (const value of [
    null,
    "",
    "company",
    "127.0.0.1",
    "[::1]",
    "localhost",
    "foo.local",
    "foo.test",
    "example.com",
    "jobs.lever.co",
    "foo.myworkdayjobs.com",
    "glints.com",
    "ycombinator.com",
    "usajobs.gov",
    "https://stripe.com/path",
    "https://user@stripe.com",
    "stripe.com?x=y",
    "stripe.com#x",
    "stripe.com\\@localhost",
    "data:image/png,123",
    "https://stripe.com:8080",
  ]) {
    assert.equal(normalizeCompanyLogoDomain(value), null, String(value));
  }
  assert.equal(companyInitials("North Star"), "NS");
  assert.equal(companyInitials("Stripe"), "ST");
  assert.equal(companyInitials(""), "?");
});

test("one cached fetch per company, no disk caching or visitor credentials", async () => {
  let calls = 0;
  let clock = 0;
  const load = createCompanyLogoLoader(
    async (url, options) => {
      calls++;
      assert.match(
        String(url),
        /^https:\/\/icons\.duckduckgo\.com\/ip3\/[a-z.]+\.ico$/,
      );
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.headers, undefined);
      return new Response(icon);
    },
    () => clock,
  );
  const [a, b] = await Promise.all([load("stripe.com"), load("stripe.com")]);
  assert.equal(a, b);
  assert.equal(a?.contentType, "image/x-icon");
  await load("stripe.com");
  assert.equal(calls, 1);
  clock = 86_400_001;
  await load("stripe.com");
  assert.equal(calls, 2);
});

test("failed and unsafe responses fall back and are negatively cached", async () => {
  for (const response of [
    () =>
      new Response("<svg onload='x'/>", {
        headers: { "content-type": "image/png" },
      }),
    () => new Response(icon, { status: 404 }),
    () => new Response(new Uint8Array(COMPANY_LOGO_MAX_BYTES + 1)),
    () =>
      new Response(icon, {
        headers: { "content-length": String(COMPANY_LOGO_MAX_BYTES + 1) },
      }),
  ]) {
    let calls = 0;
    const load = createCompanyLogoLoader(async () => {
      calls++;
      return response();
    });
    assert.equal(await load("stripe.com"), null);
    assert.equal(await load("stripe.com"), null);
    assert.equal(calls, 2);
    assert.equal(await load("localhost"), null);
    assert.equal(calls, 2);
  }
});

test("logo identities require exact company and source evidence, not an ATS slug guess", () => {
  const input = {
    company: "Motive",
    companyRecord: { name: "Motive", domain: "motive.com" },
    sourceUrls: ["https://job-boards.greenhouse.io/gomotive/jobs/1"],
  };
  assert.equal(resolveCompanyLogoDomain(input), "gomotive.com");
  assert.equal(
    resolveCompanyLogoDomain({
      ...input,
      sourceUrls: ["https://job-boards.greenhouse.io/gomotive-other/jobs/1"],
    }),
    "motive.com",
  );
  assert.equal(
    resolveCompanyLogoDomain({
      ...input,
      sourceUrls: ["https://job-boards.greenhouse.io.evil.com/gomotive"],
    }),
    "motive.com",
  );
  assert.equal(
    resolveCompanyLogoDomain({ ...input, company: "Different company" }),
    null,
  );
  assert.equal(
    resolveCompanyLogoDomain({
      company: "Customer.io",
      sourceUrls: ["https://boards.greenhouse.io/customerio/jobs/1"],
    }),
    "customer.io",
  );
  assert.equal(resolveCompanyLogoDomain({ company: "Customer.io" }), null);
  assert.equal(
    resolveCompanyLogoDomain({
      company: "Unknown",
      sourceUrls: ["https://boards.greenhouse.io/unknown"],
    }),
    null,
  );
});

test("company sites resolve careers subdomains but mismatched organizations remain unbranded", () => {
  assert.equal(
    resolveCompanyLogoDomain({
      company: "Schneider Electric",
      companyRecord: {
        name: "Schneider Electric",
        domain: "careers.se.com",
        careersUrl: "https://careers.se.com/jobs/",
      },
    }),
    "se.com",
  );
  assert.equal(
    resolveCompanyLogoDomain({
      company: "Amphenol",
      companyRecord: {
        name: "Amphenol",
        domain: "amphenol.com",
        careersUrl: "https://careers.agcocorp.com/jobs/",
      },
    }),
    null,
  );
  assert.equal(
    resolveCompanyLogoDomain({
      company: "Aviri",
      companyRecord: { domain: "glints.com" },
    }),
    null,
  );
});

test("every audited identity has a valid employer domain and requires source evidence", () => {
  for (const identity of COMPANY_LOGO_IDENTITIES) {
    assert.equal(normalizeCompanyLogoDomain(identity.domain), identity.domain);
    for (const company of identity.names) {
      assert.equal(resolveCompanyLogoDomain({ company }), null);
      for (const source of identity.sources) {
        assert.equal(
          resolveCompanyLogoDomain({
            company,
            sourceUrls: [`https://${source}`],
          }),
          identity.domain,
        );
        assert.equal(
          resolveCompanyLogoDomain({
            company: "Unrelated employer",
            sourceUrls: [`https://${source}`],
          }),
          null,
        );
      }
    }
  }
});

test("a bounded favicon fallback recovers missing primary images without disk writes", async () => {
  const urls: string[] = [];
  const load = createCompanyLogoLoader(async (url, options) => {
    urls.push(String(url));
    assert.equal(options?.cache, "no-store");
    assert.equal(options?.redirect, "error");
    return urls.length === 1
      ? new Response(null, { status: 404 })
      : new Response(icon);
  });
  assert.ok(await load("sunpharma.com"));
  assert.equal(urls.length, 2);
  assert.ok(urls[1].startsWith("https://t2.gstatic.com/faviconV2?"));
  assert.equal(new URL(urls[1]).searchParams.get("size"), "32");
  await load("sunpharma.com");
  assert.equal(urls.length, 2);
});

test("logo memory evicts old domains rather than growing with the job pool", async () => {
  let calls = 0;
  const load = createCompanyLogoLoader(async () => {
    calls++;
    return new Response(icon);
  });
  for (let index = 0; index <= COMPANY_LOGO_CACHE_ENTRIES; index++)
    await load(`company${index}.com`);
  await load("company0.com");
  assert.equal(calls, COMPANY_LOGO_CACHE_ENTRIES + 2);
});

test("simultaneous logo misses are bounded and upstream outages fail closed", async () => {
  const releases: Array<() => void> = [];
  const load = createCompanyLogoLoader(async () => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return new Response(icon);
  });
  const requests = Array.from({ length: 64 }, (_, index) =>
    load(`bounded${index}.com`),
  );
  assert.equal(await load("overflow.com"), null);
  assert.equal(releases.length, 64);
  releases.forEach((release) => release());
  await Promise.all(requests);
  const outage = createCompanyLogoLoader(async () => {
    throw new Error("upstream unavailable");
  });
  assert.equal(await outage("stripe.com"), null);
});
