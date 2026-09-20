import Link from "next/link";
import { redirect } from "next/navigation";

import { DocumentComparison } from "@/components/documents/document-comparison";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getComparableDocuments } from "@/lib/queries/tracker";

export default async function DocumentComparePage() {
  const sessionUser = await getOptionalSessionUser();
  if (!sessionUser) {
    redirect("/sign-in");
  }

  const { documents } = await getComparableDocuments();

  return (
    <div className="app-page app-page-workspace space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Compare Documents</h1>
          <p className="page-description">
            Review the exact differences between stored resumes, cover letters, and templates.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/documents" className="hover:text-foreground">
            Documents
          </Link>
          <Link href="/applications" className="hover:text-foreground">
            Applications
          </Link>
        </div>
      </div>

      {documents.length < 2 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Upload at least two documents from your document library to compare them here.
        </div>
      ) : (
        <DocumentComparison documents={documents} />
      )}
    </div>
  );
}
