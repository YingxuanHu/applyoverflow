import Link from "next/link";
import { redirect } from "next/navigation";
import { ExtensionConsent } from "@/components/applications/extension-consent";
import {
  allowedExtension,
  extensionRequestSchema,
} from "@/lib/application-assistant";
import {
  getOptionalSessionUser,
  requireCurrentUserProfile,
} from "@/lib/current-user";

export const metadata = {
  title: "Connect application assistant",
  referrer: "no-referrer" as const,
};

export default async function ExtensionConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const input = extensionRequestSchema.safeParse({
    clientId: params.clientId,
    challenge: params.challenge,
    state: params.state,
  });
  if (!input.success || !allowedExtension(input.data.clientId))
    return (
      <div className="app-page py-12">
        <h1 className="page-title">Connection unavailable</h1>
        <p className="mt-3 text-muted-foreground">
          Start from an enabled ApplyOverflow extension.
        </p>
        <Link href="/jobs">Back to jobs</Link>
      </div>
    );
  const user = await getOptionalSessionUser();
  if (!user)
    redirect(
      `/sign-in?callbackUrl=${encodeURIComponent(`/extension/connect?${new URLSearchParams(input.data)}`)}`,
    );
  await requireCurrentUserProfile();
  return (
    <div className="app-page max-w-xl space-y-6 py-12">
      <header>
        <h1 className="page-title">Connect application assistant</h1>
        <p className="mt-2 break-all text-sm text-muted-foreground">
          {user.email}
        </p>
      </header>
      <ul className="list-disc space-y-3 pl-5 text-sm leading-6">
        <li>Share your confirmed name, email, phone, and profile links.</li>
        <li>
          Save job links and question labels to your application workspace when
          you choose Review.
        </li>
        <li>
          No access to passwords or application submission. Sharing a resume
          requires a separate file choice and confirmation each time.
        </li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Access expires after eight hours or when this sign-in session ends.
        Disconnect at any time in Settings.
      </p>
      <ExtensionConsent request={input.data} />
      <Link className="text-sm text-muted-foreground underline" href="/jobs">
        Cancel
      </Link>
    </div>
  );
}
