import { redirect } from "next/navigation";
import { WorkflowTabs } from "@/components/applications/workflow-tabs";
import { AutoApplyWorkspace } from "@/components/applications/auto-apply-workspace";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getAutoApplyWorkspace } from "@/lib/queries/auto-apply";

export default async function AutoApplyPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/sign-in?callbackUrl=%2Fapplications%2Fauto-apply");
  const data = await getAutoApplyWorkspace(user.id);
  return <div className="app-page app-page-workspace space-y-5">
    <header className="page-header"><h1 className="page-title">Applications</h1></header>
    <WorkflowTabs active="auto-apply" />
    <AutoApplyWorkspace initial={data} />
  </div>;
}
