import {
  fetchGuarded,
  type FetchGuardDeps,
} from "@/lib/ingestion/net/ssrf-guard";
import {
  extractEmbeddedDescription,
  formatJobDescriptionText,
  isLikelyWrongPageJobDescription,
  isLowQualityJobDescription,
  pickBestFormattedJobDescription,
  selectDescriptionSource,
} from "@/lib/job-description-format";

const JOB_FETCH_TIMEOUT_MS = 15_000;
const JOB_FETCH_MAX_BYTES = 5_000_000;

const JOB_FETCH_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

const NON_HTML_CONTENT_TYPE =
  /^(?:image|audio|video)\/|application\/(?:pdf|zip|octet-stream)/i;

const JS_SHELL_SIGNALS = [
  "you need to enable javascript",
  "please enable javascript",
  "requires javascript",
  "enable javascript to run",
];

function buildJobFetchHeaders(userAgent: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
  };
  if (userAgent.includes("Chrome")) {
    headers["sec-ch-ua"] =
      '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"';
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = '"Windows"';
  }
  return headers;
}

async function readResponseTextCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
      if (received >= maxBytes) break;
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

function isCandidateDescriptionUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function fetchFormattedJobDescriptionFromUrl(
  url: string,
  deps: FetchGuardDeps = {}
): Promise<string | null> {
  for (const userAgent of JOB_FETCH_USER_AGENTS) {
    let html: string;
    try {
      const response = await fetchGuarded(
        url,
        {
          headers: buildJobFetchHeaders(userAgent),
          signal: AbortSignal.timeout(JOB_FETCH_TIMEOUT_MS),
          cache: "no-store",
        },
        deps
      );

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (NON_HTML_CONTENT_TYPE.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }

      html = await readResponseTextCapped(response, JOB_FETCH_MAX_BYTES);
    } catch {
      continue;
    }

    if (!html) continue;

    const embedded = extractEmbeddedDescription(html);
    const pageText = formatJobDescriptionText(selectDescriptionSource(html));
    const looksLikeDeadJsShell =
      !embedded &&
      pageText.length < 300 &&
      JS_SHELL_SIGNALS.some((signal) => html.toLowerCase().includes(signal));

    if (
      looksLikeDeadJsShell ||
      isLikelyWrongPageJobDescription(pageText, html) ||
      isLowQualityJobDescription(pageText)
    ) {
      continue;
    }

    return pageText;
  }

  return null;
}

export async function fetchBestFormattedJobDescriptionFromUrls(
  urls: string[],
  maxFetches = 3
) {
  const candidateUrls = Array.from(new Set(urls.filter(isCandidateDescriptionUrl))).slice(
    0,
    Math.max(1, maxFetches)
  );

  if (candidateUrls.length === 0) {
    return null;
  }

  const fetchedDescriptions = await Promise.all(
    candidateUrls.map((url) => fetchFormattedJobDescriptionFromUrl(url))
  );

  return pickBestFormattedJobDescription(fetchedDescriptions);
}
