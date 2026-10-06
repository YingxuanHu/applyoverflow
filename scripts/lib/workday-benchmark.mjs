export function workdayBenchmarkTarget(token) {
  const [host, tenant, site, extra] = String(token).split("|");
  if (extra !== undefined || !/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host || "") ||
      !/^[a-z0-9_-]+$/i.test(tenant || "") || !/^[a-z0-9_-]+$/i.test(site || ""))
    throw new Error("Expected a public Workday host|tenant|site token");
  return { host: host.toLowerCase(), tenant, site };
}

export async function discoverWorkdayBenchmarkJobs(token, fetcher = fetch) {
  const { host, tenant, site } = workdayBenchmarkTarget(token);
  const origin = `https://${host}`, board = `${origin}/${site}`;
  const landing = await fetcher(board, { signal: AbortSignal.timeout(15000) });
  if (!landing.ok) throw new Error(`Workday landing HTTP ${landing.status}`);
  const cookie = (landing.headers.getSetCookie?.() || []).map(value => value.split(";")[0]).join("; ");
  const jobs = [];
  for (const offset of [0, 20]) {
    const response = await fetcher(`${origin}/wday/cxs/${tenant}/${site}/jobs`, {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json", "Content-Type": "application/json", Origin: origin, Referer: board,
        ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }),
    });
    if (!response.ok) throw new Error(`Workday job catalog HTTP ${response.status}`);
    const payload = await response.json();
    for (const job of payload.jobPostings || []) {
      if (typeof job.externalPath !== "string" || !/^\/job\/[^?#]+$/.test(job.externalPath)) continue;
      jobs.push({ title: job.title, location: job.locationsText,
        url: `${origin}/en-US/${site}${job.externalPath}/apply` });
    }
    if (!payload.jobPostings?.length || payload.total <= offset + 20) break;
  }
  return [...new Map(jobs.map(job => [job.url, job])).values()];
}

/** @param {{ headings?: string[], body?: string, password?: boolean }} state */
export function workdayBenchmarkStage({ headings = [], body = "", password = false }) {
  if (/verify you are human|access denied|checking your browser/i.test(body)) return "captcha";
  if (/something went wrong|error code: VPS\|/i.test(body)) return "server-error";
  if (/job (?:is no longer|has been filled)|no longer available/i.test(body)) return "expired";
  if (password || /create account\/sign in|sign in to apply/i.test(body)) return "sign-in";
  const steps = { "my information": "contact", "my experience": "history", "application questions": "questions",
    "voluntary disclosures": "disclosures", review: "review", "start your application": "entry" };
  return headings.map(heading => steps[heading.trim().toLowerCase()]).find(Boolean) || "unavailable";
}
