import { JobsWorkspaceHeader } from "@/components/jobs/jobs-workspace-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
export default function Loading() {
  return <div className="app-page app-page-workspace space-y-6"><JobsWorkspaceHeader active="auto-apply" /><p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LoadingSpinner className="size-4" />Loading matches and your review queue...</p></div>;
}
