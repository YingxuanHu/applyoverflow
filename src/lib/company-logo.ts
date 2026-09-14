import { COMPANY_LOGO_IDENTITIES } from "@/lib/company-logo-identities";

// Never use an ATS or aggregator's favicon as an employer's logo.
const SHARED_JOB_HOSTS = [
  "greenhouse.io",
  "greenhouse.com",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "myworkdaysite.com",
  "workable.com",
  "icims.com",
  "smartrecruiters.com",
  "jobvite.com",
  "bamboohr.com",
  "taleo.net",
  "oraclecloud.com",
  "recruitee.com",
  "teamtailor.com",
  "successfactors.com",
  "linkedin.com",
  "indeed.com",
  "ziprecruiter.com",
  "jsearch.io",
  "glints.com",
  "adzuna.com",
  "adzuna.ca",
  "jooble.org",
  "rippling.com",
  "jobicy.com",
  "remoteok.com",
  "remotive.com",
  "themuse.com",
  "himalayas.app",
  "jobbank.gc.ca",
  "usajobs.gov",
  "weworkremotely.com",
  "lensa.com",
  "ycombinator.com",
  "successfactors.eu",
];

export function normalizeCompanyLogoDomain(
  value?: string | null,
): string | null {
  if (!value || value.length > 300 || /[\s\\@?#]/.test(value)) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.port ||
      url.pathname !== "/"
    )
      return null;
    const domain = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    )
      return null;
    if (
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|lan|home|onion)$/.test(
        domain,
      )
    )
      return null;
    if (
      ["example.com", "example.org", "example.net", ...SHARED_JOB_HOSTS].some(
        (host) => domain === host || domain.endsWith(`.${host}`),
      )
    )
      return null;
    return domain;
  } catch {
    return null;
  }
}

function identityName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function sourceMatches(value: string, source: string) {
  try {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return false;
    const expected = new URL(`https://${source}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();
    return (
      host === expected.hostname &&
      (expected.pathname === "/" ||
        path === expected.pathname ||
        path.startsWith(`${expected.pathname}/`))
    );
  } catch {
    return false;
  }
}

function employerHost(value?: string | null) {
  const domain = normalizeCompanyLogoDomain(value);
  if (!domain) return null;
  // Careers subdomains often carry the ATS favicon, rather than employer branding.
  const parent = domain.replace(
    /^(?:(?:careers?|jobs|recruiting|recruitment)\.)+/,
    "",
  );
  return normalizeCompanyLogoDomain(parent);
}

export function resolveCompanyLogoDomain(input: {
  company: string;
  companyRecord?: {
    name?: string;
    domain: string | null;
    careersUrl?: string | null;
  } | null;
  sourceUrls?: Array<string | null | undefined>;
}): string | null {
  const name = identityName(input.company);
  const record = input.companyRecord;
  const sources = [...(input.sourceUrls ?? []), record?.careersUrl].filter(
    (url): url is string => Boolean(url),
  );
  for (const identity of COMPANY_LOGO_IDENTITIES) {
    if (
      identity.names.some((alias) => identityName(alias) === name) &&
      sources.some((url) =>
        identity.sources.some((source) => sourceMatches(url, source)),
      )
    )
      return identity.domain;
  }
  if (record?.name && identityName(record.name) !== name) return null;
  const domain = employerHost(record?.domain);
  if (!domain) return null;
  // Do not silently brand a job with an unrelated company when its first-party
  // careers site conflicts with the linked company record (e.g. AGCO/Amphenol).
  if (record?.careersUrl) {
    try {
      const careersHost = employerHost(new URL(record.careersUrl).hostname);
      if (
        careersHost &&
        careersHost !== domain &&
        !careersHost.endsWith(`.${domain}`) &&
        !domain.endsWith(`.${careersHost}`)
      )
        return null;
    } catch {
      /* A malformed careers URL supplies no identity evidence. */
    }
  }
  return domain;
}

export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${Array.from(words[0])[0]}${Array.from(words[1])[0]}`
      : Array.from(words[0] ?? "?")
          .slice(0, 2)
          .join("")
  ).toUpperCase();
}
