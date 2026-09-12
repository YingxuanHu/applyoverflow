import { DomUtils, parseDocument } from "htmlparser2";
import { descriptionHtmlToText } from "./description-html";

export type DescriptionIdentity = { title: string; company: string };

export function normalizeDescriptionIdentity(value: string) {
  return descriptionHtmlToText(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeCompany(value: string) {
  return normalizeDescriptionIdentity(value).replace(/\s+(?:incorporated|inc|llc|ltd|limited|corp|corporation)$/, "");
}

export function matchesDescriptionIdentity(candidate: DescriptionIdentity, expected: DescriptionIdentity) {
  return Boolean(candidate.title && candidate.company) &&
    normalizeDescriptionIdentity(candidate.title) === normalizeDescriptionIdentity(expected.title) &&
    normalizeCompany(candidate.company) === normalizeCompany(expected.company);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function postingUrl(value: unknown, base: string) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, base);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$)/.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.href;
  } catch { return null; }
}

/** Strict repair selection: never use an unrelated JSON description or another vacancy. */
export function selectMatchingSourceDescription(html: string, url: string, expected: DescriptionIdentity): string | null {
  const document = parseDocument(html);
  const scripts = DomUtils.findAll((node) => node.name === "script" && node.attribs.type?.toLowerCase() === "application/ld+json", document.children);
  const postings: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 12) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    const record = object(value);
    if (!record) return;
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    if (types.includes("JobPosting")) postings.push(record);
    for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) visit(record[key], depth + 1);
  };
  for (const script of scripts) {
    try { visit(JSON.parse(DomUtils.textContent(script))); } catch { /* Malformed source JSON is not evidence of a matching job. */ }
  }
  const candidates = postings.filter((posting) => {
    if (typeof posting.title !== "string" || normalizeDescriptionIdentity(posting.title) !== normalizeDescriptionIdentity(expected.title)) return false;
    const canonicalUrl = postingUrl(posting.url, url);
    if (canonicalUrl && canonicalUrl !== postingUrl(url, url)) return false;
    const organization = object(posting.hiringOrganization);
    const company = typeof organization?.name === "string" ? organization.name : "";
    if (company) return matchesDescriptionIdentity({ title: posting.title, company }, expected);
    return postingUrl(posting.url, url) === postingUrl(url, url);
  });
  const exactUrl = candidates.filter((posting) => postingUrl(posting.url, url) === postingUrl(url, url));
  const matches = exactUrl.length ? exactUrl : candidates;
  const descriptions = [...new Set(matches.map((posting) => typeof posting.description === "string" ? posting.description.trim() : "").filter(Boolean))];
  if (descriptions.length === 1) return descriptions[0];
  // Multiple distinct matches or explicit structured data for another job are ambiguous.
  if (postings.length) return null;

  const headings = DomUtils.findAll((node) => node.name === "h1", document.children);
  if (!headings.some((heading) => normalizeDescriptionIdentity(DomUtils.textContent(heading)) === normalizeDescriptionIdentity(expected.title))) return null;
  const containers = DomUtils.findAll((node) => node.attribs.itemprop === "description" ||
    /(?:^|\s)(?:job[-_]?description|posting[-_]?description|job[-_]?details[-_]?description)(?:\s|$)/i.test(`${node.attribs.id ?? ""} ${node.attribs.class ?? ""}`), document.children);
  const contents = [...new Set(containers.map((container) => DomUtils.getOuterHTML(container)))];
  return contents.length === 1 ? contents[0] : null;
}
