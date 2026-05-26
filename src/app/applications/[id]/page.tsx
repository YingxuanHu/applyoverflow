import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplicationWorkspaceClient } from "@/components/applications/workspace-client";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getOpenAIReadiness } from "@/lib/openai";
import { getTrackedApplicationWorkspace } from "@/lib/queries/tracker";

export default async function TrackedApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const sessionUser = await getOptionalSessionUser();
  if (!sessionUser) {
    redirect("/sign-in");
  }

  const { id } = await params;
  const { edit } = await searchParams;
  const workspace = await getTrackedApplicationWorkspace(id);
  if (!workspace.application) {
    notFound();
  }

  return (
    <div className="app-page space-y-4">
      <div>
        <Link className="text-sm text-muted-foreground hover:text-foreground" href="/applications">
          &larr; Back to applications
        </Link>
      </div>

      <ApplicationWorkspaceClient
        aiConfigured={getOpenAIReadiness().configured}
        application={workspace.application}
        generatedDocuments={workspace.generatedDocuments}
        initialHeaderEditing={edit === "1"}
        userDocuments={workspace.userDocuments}
        userTags={workspace.userTags}
      />
    </div>
  );
}
