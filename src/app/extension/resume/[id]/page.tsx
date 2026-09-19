import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSessionUser } from "@/lib/current-user";
import { applicationContext } from "@/lib/application-assistant";
import { getExtensionResumeChoice } from "@/lib/queries/extension-resume";
import { ExtensionResumeChoice } from "@/components/applications/extension-resume-choice";

export const metadata = {
  title: "Choose a resume",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};

export default async function ExtensionResumePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getOptionalSessionUser();
  if (!user)
    redirect(
      `/sign-in?callbackUrl=${encodeURIComponent(`/extension/resume/${id}`)}`,
    );
  const choice = await getExtensionResumeChoice(user.id, id);
  if (!choice)
    return (
      <div className="app-page max-w-xl space-y-3 py-12">
        <h1 className="page-title">Resume choice unavailable</h1>
        <p className="text-sm text-muted-foreground">
          This request expired or belongs to another account. Close this window
          and choose a resume from the extension again.
        </p>
      </div>
    );
  const context = applicationContext(choice.applicationUrl)!;
  return (
    <div className="app-page max-w-xl space-y-6 py-10">
      <header className="space-y-2">
        <h1 className="page-title">Attach your resume</h1>
        <p className="break-all text-sm text-muted-foreground">{user.email}</p>
      </header>
      <section className="space-y-2 border-y py-4 text-sm">
        <p className="font-medium break-words">
          Application at {context.tenant}
        </p>
        <a
          href={context.url}
          target="_blank"
          rel="noreferrer"
          className="block break-all text-primary underline underline-offset-4"
        >
          {context.url}
        </a>
        <p className="text-muted-foreground">
          Only the file you choose will be shared for this application. The
          employer may upload or process it immediately. Nothing will be
          submitted on your behalf.
        </p>
      </section>
      {choice.documents.length ? (
        <ExtensionResumeChoice
          id={id}
          documents={choice.documents}
          cancelUrl={choice.cancelUrl}
        />
      ) : (
        <div className="space-y-4 text-sm">
          <p>
            No eligible resume files. Add a PDF or DOCX resume of 5 MB or less
            in Documents, then try again.
          </p>
          <Link
            href="/documents"
            target="_blank"
            className="text-primary underline"
          >
            Open Documents
          </Link>
          <a
            href={choice.cancelUrl}
            className="ml-4 text-muted-foreground underline"
          >
            Cancel
          </a>
        </div>
      )}
    </div>
  );
}
