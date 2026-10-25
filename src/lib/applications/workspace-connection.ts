import { EXTENSION_STORE_ID } from "@/lib/extension-setup";

export type WorkspaceConnection = {
  state: "checking" | "unsupported" | "unavailable" | "outdated" | "disconnected" | "ready";
  id: string;
  message: string;
};

export async function checkWorkspaceConnection(
  hasRuntime: boolean,
  connectedIds: string[],
  ping: (id: string) => Promise<{ protocol?: number; version?: string }>,
): Promise<WorkspaceConnection> {
  if (!hasRuntime) return { state: "unsupported", id: "", message: "Chrome with ApplyOverflow is required to prepare applications here." };
  let installed = false, compatible = false;
  for (const id of [...new Set([...connectedIds, EXTENSION_STORE_ID])]) {
    try {
      const reply = await ping(id);
      installed = true;
      if (reply.protocol !== 1) continue;
      compatible = true;
      if (connectedIds.includes(id)) return { state: "ready", id, message: `Extension ${reply.version ?? ""} connected`.trim() };
    } catch { /* A connection on another browser is not evidence of installation here. */ }
  }
  if (compatible) return { state: "disconnected", id: "", message: "Extension found. Connect it to this ApplyOverflow account to continue." };
  if (installed) return { state: "outdated", id: "", message: "This extension does not support the application workspace. Check for an extension update." };
  return { state: "unavailable", id: "", message: "ApplyOverflow is not responding in this browser. Check that the extension is installed and enabled, then reconnect it." };
}
