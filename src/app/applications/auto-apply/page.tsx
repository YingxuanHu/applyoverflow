import { redirect } from "next/navigation";
import { JobsWorkspaceHeader } from "@/components/jobs/jobs-workspace-header";
import { AutoApplyWorkspace } from "@/components/applications/auto-apply-workspace";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getAutoApplyWorkspace } from "@/lib/queries/auto-apply";

export default async function AutoApplyPage({ searchParams }: { searchParams: Promise<{ application?: string }> }) {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/sign-in?callbackUrl=%2Fapplications%2Fauto-apply");
  const data = await getAutoApplyWorkspace(user.id);
  const { application } = await searchParams;
  const selected = data.queued.some(item => item.id === application) ? application : undefined;
  return <div className="app-page app-page-workspace space-y-6">
    <JobsWorkspaceHeader active="auto-apply" />
    <AutoApplyWorkspace key={selected ?? "matches"} initial={data} initialSelected={selected} />
  </div>;
}
