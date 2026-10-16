import { getOptionalSessionUser } from "@/lib/current-user";
import { extensionSetupCapabilities } from "@/lib/queries/extension-setup";
import { ExtensionSetup } from "@/components/applications/extension-setup";
import { EXTENSION_STORE_ID } from "@/lib/extension-setup";

export const metadata = { title: "Set up ApplyOverflow", referrer: "no-referrer" as const };
export default async function ExtensionSetupPage({ searchParams }: { searchParams: Promise<{ context?: string }> }) {
  const user = await getOptionalSessionUser();
  const params = await searchParams;
  const context = /^[A-Za-z0-9_-]{43}$/.test(params.context ?? "") ? params.context! : "";
  const ids = [...new Set([EXTENSION_STORE_ID, ...(process.env.APPLICATION_EXTENSION_IDS ?? "").split(",").map(value => value.trim()).filter(value => /^[a-p]{32}$/.test(value))])];
  return <ExtensionSetup key={user?.id ?? "signed-out"} accountId={user?.id ?? null} email={user?.email ?? null} context={context} extensionIds={ids}
    initialCapabilities={user ? await extensionSetupCapabilities(user.id) : null} />;
}
