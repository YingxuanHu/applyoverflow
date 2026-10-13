import { WorkflowTabs } from "@/components/applications/workflow-tabs";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
export default function Loading() {
  return <div className="app-page space-y-5"><h1 className="page-title">Applications</h1><WorkflowTabs active="auto-apply" /><p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LoadingSpinner className="size-4" />Loading matches and your review queue...</p></div>;
}
