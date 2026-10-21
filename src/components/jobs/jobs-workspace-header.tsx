import { JobsSectionTabs } from "@/components/jobs/jobs-section-tabs";
import type { JobsWorkspaceTab } from "@/lib/navigation/jobs-workspace";

export function JobsWorkspaceHeader({ active }: { active: JobsWorkspaceTab }) {
  return (
    <header className="page-header items-center justify-start gap-x-10 gap-y-3">
      <h1 className="page-title">Jobs</h1>
      <JobsSectionTabs active={active} />
    </header>
  );
}
