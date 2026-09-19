import Link from "next/link";
import { Download, Trash2, Unplug } from "lucide-react";
import release from "../../../../extensions/chrome/release.json";
import { requireCurrentUserIds } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  ANSWER_LIBRARY_KEY,
  allowedExtension,
  parseAnswerLibrary,
} from "@/lib/application-assistant";
import { forgetApplicationAnswer, revokeExtension } from "./actions";

export default async function ExtensionSettingsPage() {
  const { authUserId, profileId } = await requireCurrentUserIds();
  const [connections, preference] = await Promise.all([
    prisma.extensionConnection.findMany({
      where: { userId: authUserId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, clientId: true, connectedAt: true, expiresAt: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId_key: { userId: profileId, key: ANSWER_LIBRARY_KEY } },
    }),
  ]);
  const library = parseAnswerLibrary(preference?.value);
  return (
    <div className="app-page max-w-4xl space-y-6">
      <Link className="text-sm text-muted-foreground" href="/settings">
        &larr; Settings
      </Link>
      <h1 className="page-title">Application assistant</h1>
      <section className="space-y-3 border-b pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            Chrome extension{" "}
            <span className="text-xs font-normal text-muted-foreground">
              Preview {release.version}
            </span>
          </h2>
          <Button
            variant="outline"
            render={
              <a href="/downloads/applyoverflow-assistant.zip" download />
            }
          >
            <Download className="size-4" />
            Download ZIP
          </Button>
        </div>
        {!allowedExtension(release.previewId) && (
          <p className="text-sm text-muted-foreground">
            Preview connections are not enabled on this deployment yet. You can
            download and install the preview now.
          </p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Install the preview
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>Extract the downloaded ZIP into a folder.</li>
            <li>
              Open <code>chrome://extensions</code>, turn on Developer mode,
              then choose Load unpacked and select that folder.
            </li>
            <li>
              Open ApplyOverflow from the Chrome toolbar and connect your
              profile.
            </li>
            <li>
              Turn on automatic hints to allow access to Greenhouse, Lever, Ashby,
              Workday and iCIMS. You can leave this off and use the toolbar instead.
            </li>
          </ol>
          <p className="mt-3 text-muted-foreground">
            This is not a Chrome Web Store release. Contact fields and selected
            PDF/DOCX resumes up to 5 MB are supported. Each resume needs a
            separate confirmation. Supported embedded forms use their own hint
            after site access is enabled; reload the employer page if needed.
            The toolbar can also fill clearly labelled contact fields on other
            application sites and one selected work or education entry. Custom
            widgets and ambiguous fields remain manual. Applications
            are never submitted automatically.
          </p>
        </details>
        <Link href="/extension/privacy" className="inline-block text-sm text-primary underline underline-offset-4">
          Extension data use
        </Link>
      </section>
      <section className="divide-y">
        <h2 className="py-4 text-base font-semibold">Connected extensions</h2>
        {!connections.length && (
          <p className="py-4 text-sm text-muted-foreground">
            No active connections.
          </p>
        )}
        {connections.map((item) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 py-4"
            key={item.id}
          >
            <div className="min-w-0 text-sm">
              <p>
                {item.connectedAt ? "Chrome extension" : "Awaiting connection"}
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {item.clientId}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Expires{" "}
                {item.expiresAt.toISOString().replace("T", " ").slice(0, 16)}{" "}
                UTC
              </p>
            </div>
            <form action={revokeExtension}>
              <input type="hidden" name="id" value={item.id} />
              <Button type="submit" variant="outline" size="sm">
                <Unplug className="size-4" />
                Disconnect
              </Button>
            </form>
          </div>
        ))}
      </section>
      <section className="divide-y">
        <h2 className="py-4 text-base font-semibold">Remembered answers</h2>
        {!library.length && (
          <p className="py-4 text-sm text-muted-foreground">
            No remembered answers.
          </p>
        )}
        {library.map((answer) => (
          <details
            className="py-4"
            key={`${answer.companyId}:${answer.questionKey}`}
          >
            <summary className="cursor-pointer break-words text-sm font-medium">
              {answer.questionLabel ?? answer.questionKey}
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {answer.companyLabel ?? answer.companyId.split(":").at(-1)}
              </span>
            </summary>
            <p className="my-4 whitespace-pre-wrap break-words text-sm">
              {answer.answer}
            </p>
            <form action={forgetApplicationAnswer}>
              <input name="company" type="hidden" value={answer.companyId} />
              <input name="key" type="hidden" value={answer.questionKey} />
              <Button type="submit" variant="outline" size="sm">
                <Trash2 className="size-4" />
                Forget answer
              </Button>
            </form>
          </details>
        ))}
      </section>
    </div>
  );
}
