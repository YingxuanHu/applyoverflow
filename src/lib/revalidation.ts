import { revalidatePath } from "next/cache";

export function revalidatePaths(paths: Iterable<string>) {
  for (const path of paths) {
    revalidatePath(path);
  }
}

export function revalidateProfileViews() {
  revalidatePaths([
    "/profile",
    "/applications",
    "/applications/history",
    "/dashboard",
  ]);
}

export function revalidateTrackerOverviewViews() {
  revalidatePaths([
    "/applications",
    "/applications/history",
    "/dashboard",
    "/notifications",
  ]);
}

export function revalidateNotificationCenterViews() {
  revalidatePaths(["/notifications", "/applications", "/dashboard"]);
}

export function revalidateApplicationWorkspaceViews(
  applicationId: string,
  options: { includeProfile?: boolean } = {}
) {
  revalidatePaths([
    "/applications",
    "/applications/history",
    "/dashboard",
    ...(options.includeProfile ? ["/profile"] : []),
    `/applications/${applicationId}`,
    `/dashboard/${applicationId}`,
  ]);
}

export function revalidateDeletedApplicationViews(
  canonicalJobId?: string | null
) {
  revalidateTrackerOverviewViews();
  if (!canonicalJobId) return;

  revalidatePaths(["/jobs", `/jobs/${canonicalJobId}`]);
}
