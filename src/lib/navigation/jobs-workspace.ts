// Installed extensions restrict workspace messages to this exact URL. Keep the
// transport route stable while presenting Auto Apply as part of Jobs.
export const AUTO_APPLY_HREF = "/applications/auto-apply";

export const JOBS_WORKSPACE_LINKS = [
  { href: "/jobs", key: "jobs", label: "Jobs" },
  { href: "/jobs/top-picks", key: "top-picks", label: "Picks for you" },
  { href: AUTO_APPLY_HREF, key: "auto-apply", label: "Auto Apply" },
] as const;

export type JobsWorkspaceTab = (typeof JOBS_WORKSPACE_LINKS)[number]["key"];

export function getJobsWorkspaceTab(pathname: string): JobsWorkspaceTab | null {
  if (pathname === AUTO_APPLY_HREF || pathname.startsWith(`${AUTO_APPLY_HREF}/`)) return "auto-apply";
  if (pathname === "/jobs/top-picks" || pathname.startsWith("/jobs/top-picks/")) return "top-picks";
  if (pathname === "/jobs" || pathname.startsWith("/jobs/")) return "jobs";
  return null;
}
