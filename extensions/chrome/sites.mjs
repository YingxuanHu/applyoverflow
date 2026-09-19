export const SITE_ORIGINS = [
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://boards.eu.greenhouse.io/*",
  "https://job-boards.eu.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://jobs.eu.lever.co/*",
  "https://jobs.ashbyhq.com/*",
];

// Shared by the server, worker and isolated scanner. Tenant and region are part
// of the identity; tracking parameters and the apply step are not.
export function applicationContext(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const gh = /^(?:job-boards|boards)(\.eu)?\.greenhouse\.io$/.exec(
      url.hostname,
    );
    if (gh) {
      const match = /^\/([a-zA-Z0-9_-]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
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
    if (!lever && !ashby) return null;
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
