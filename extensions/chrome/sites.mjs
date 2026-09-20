export const SITE_ORIGINS = [
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://boards.eu.greenhouse.io/*",
  "https://job-boards.eu.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://jobs.eu.lever.co/*",
  "https://jobs.ashbyhq.com/*",
  "https://*.myworkdayjobs.com/*",
  "https://*.icims.com/*",
  "https://apply.workable.com/*",
];

// Shared by the server, worker and isolated scanner. Tenant and region are part
// of the identity; tracking parameters and the apply step are not.
export function applicationContext(raw, allowGeneric = false) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    if (url.hostname === "apply.workable.com") {
      const match = /^\/([a-zA-Z0-9_-]+)\/j\/([a-f0-9]{10})(?:\/apply)?\/?$/i.exec(
        url.pathname,
      );
      if (
        !match || url.hash || [...url.searchParams.keys()].some(key =>
          /token|session|secret|password|email|auth|code|signature/i.test(key))
      ) return null;
      const tenant = match[1].toLowerCase();
      return {
        provider: "workable", tenant, companyKey: `workable:${tenant}`,
        url: `https://apply.workable.com/${tenant}/j/${match[2].toUpperCase()}/`,
      };
    }
    const workday = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.exec(
      url.hostname,
    );
    if (workday) {
      const match = /^\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)\/job\/(.+?)\/?$/.exec(
        url.pathname,
      );
      if (!match) return null;
      const path = match[2].split("/");
      const apply = path.indexOf("apply");
      const job = apply === -1 ? path : path.slice(0, apply);
      if (job.length < 1 || job.length > 2 || job.some((part) => !part))
        return null;
      return {
        provider: "workday",
        tenant: workday[1],
        companyKey: `workday:${url.hostname}:${match[1]}`,
        jobKey: `workday:${url.hostname}:${match[1]}:${job.at(-1)}`,
        url: `https://${url.hostname}/${match[1]}/job/${job.join("/")}`,
      };
    }
    const icims = /^([a-z0-9-]+)\.icims\.com$/.exec(url.hostname);
    if (icims) {
      const match =
        /^\/jobs\/(\d+)\/(?:[^/]+\/)?(?:job|apply|application|profile)\/?$/.exec(
          url.pathname,
        );
      if (!match) return null;
      return {
        provider: "icims",
        tenant: icims[1],
        companyKey: `icims:${url.hostname}`,
        url: `https://${url.hostname}/jobs/${match[1]}/job`,
      };
    }
    const gh = /^(?:job-boards|boards)(\.eu)?\.greenhouse\.io$/.exec(
      url.hostname,
    );
    if (gh) {
      const embedded = url.pathname === "/embed/job_app";
      // Both identifiers are required. Duplicate query keys are ambiguous, even
      // when a browser or backend happens to select the first one.
      const match = embedded
        ? url.searchParams.getAll("for").length === 1 &&
          url.searchParams.getAll("token").length === 1 &&
          /^[a-zA-Z0-9_-]+$/.test(url.searchParams.get("for")) &&
          /^\d+$/.test(url.searchParams.get("token"))
          ? ["", url.searchParams.get("for"), url.searchParams.get("token")]
          : null
        : /^\/([a-zA-Z0-9_-]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
      if (!match) return null;
      const tenant = match[1].toLowerCase();
      const region = gh[1] ? "eu" : "us";
      return {
        provider: "greenhouse",
        tenant,
        companyKey: `greenhouse:${region}:${tenant}`,
        url: `https://job-boards.${region === "eu" ? "eu." : ""}greenhouse.io/${tenant}/jobs/${match[2]}`,
      };
    }
    const lever = /^(jobs(?:\.eu)?)\.lever\.co$/.exec(url.hostname);
    const ashby = url.hostname === "jobs.ashbyhq.com";
    if (!lever && !ashby) {
      // Only explicit toolbar inspection uses this fallback. Never register an
      // all-sites content script or send generic URLs containing auth material.
      if (
        !allowGeneric ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) ||
        /(?:^|\.)(?:localhost|local|internal|myworkdayjobs\.com|icims\.com|greenhouse\.io|lever\.co|ashbyhq\.com|applyoverflow\.com)$/.test(
          url.hostname,
        ) ||
        /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
        /\.(?:pdf|docx?|zip|jpe?g|png|json|xml)$/i.test(url.pathname) ||
        /(?:^|\/)(?:login|sign-in|signin|signup|sign-up|register|account|oauth|callback)(?:\/|$)/i.test(
          url.pathname,
        ) ||
        [...url.searchParams.keys()].some((key) =>
          /token|session|secret|password|email|auth|code|signature/i.test(key),
        ) ||
        url.hash
      )
        return null;
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_.*|source|ref|referrer|gclid|fbclid)$/i.test(key))
          url.searchParams.delete(key);
      }
      url.searchParams.sort();
      return {
        provider: "generic",
        tenant: url.hostname,
        companyKey: `site:${url.href}`,
        url: url.href,
      };
    }
    const match =
      /^\/([a-zA-Z0-9_-]+)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/(apply|application))?\/?$/i.exec(
        url.pathname,
      );
    if (!match || (match[3] && match[3] !== (lever ? "apply" : "application")))
      return null;
    const provider = lever ? "lever" : "ashby";
    const tenant = match[1].toLowerCase();
    const region = url.hostname.includes(".eu.") ? "eu" : "us";
    return {
      provider,
      tenant,
      companyKey: `${provider}:${region}:${tenant}`,
      url: `https://${url.hostname}/${tenant}/${match[2].toLowerCase()}`,
    };
  } catch {
    return null;
  }
}

// Workday can rewrite the human-readable location segment between the posting
// and application steps. The tenant/site/requisition slug remains the identity.
export function sameApplication(left, right) {
  const a = applicationContext(left, true);
  const b = applicationContext(right, true);
  return !!a && !!b && (a.jobKey ?? a.url) === (b.jobKey ?? b.url);
}
