import { APP_ORIGIN } from "./config.mjs";
import { SITE_ORIGINS } from "./sites.mjs";
const status = document.getElementById("status");
document.getElementById("profile").href = `${APP_ORIGIN}/profile`;
document.getElementById("settings").href = `${APP_ORIGIN}/settings/extension`;
async function run(type) {
  for (const button of document.querySelectorAll("button"))
    button.disabled = true;
  if (type !== "status")
    status.textContent =
      type === "connect"
        ? "Complete the connection in ApplyOverflow..."
        : type === "resume"
          ? "Choose and approve a resume in ApplyOverflow..."
          : "Working...";
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (!result)
      throw new Error(
        "Open ApplyOverflow from the Chrome toolbar and try again.",
      );
    if (result.reconnect) {
      document.getElementById("connect").hidden = false;
      document.getElementById("actions").hidden = true;
      document.getElementById("disconnect").hidden = true;
      document.getElementById("account").hidden = true;
    }
    if (result.error) throw new Error(result.error);
    if (result.email !== undefined) {
      document.getElementById("account").textContent = result.email;
      document.getElementById("account").hidden = !result.email;
    }
    if (!result.connected) document.getElementById("account").hidden = true;
    document.getElementById("connect").hidden = result.connected;
    document.getElementById("actions").hidden = !result.connected;
    document.getElementById("disconnect").hidden = !result.connected;
    if (result.undoAvailable !== undefined)
      document.getElementById("undo").hidden = !result.undoAvailable;
    status.textContent = result.message;
  } catch (error) {
    status.textContent = error.message || "Could not complete the action.";
  } finally {
    for (const button of document.querySelectorAll("button"))
      button.disabled = false;
  }
}
for (const type of ["connect", "fill", "review", "resume", "disconnect", "undo"])
  document.getElementById(type).addEventListener("click", () => void run(type));
void run("status");
const detection = document.getElementById("detection");
async function updateAccess() {
  const permissions = await chrome.permissions.getAll();
  const count = SITE_ORIGINS.filter((origin) =>
    permissions.origins?.includes(origin),
  ).length;
  detection.checked = count === SITE_ORIGINS.length;
  detection.indeterminate = count > 0 && count < SITE_ORIGINS.length;
}
detection.addEventListener("change", async () => {
  const enable = detection.checked;
  detection.disabled = true;
  try {
    // request() must run directly from this user gesture, not in the worker.
    const accepted = enable
      ? await chrome.permissions.request({ origins: SITE_ORIGINS })
      : await chrome.permissions.remove({ origins: SITE_ORIGINS });
    await chrome.runtime.sendMessage({ type: "detection-updated" });
    status.textContent = accepted
      ? enable
        ? "Autofill hints enabled on supported sites."
        : "Automatic hints turned off. The toolbar still works."
      : "Site access was not granted. You can still use the toolbar.";
  } catch {
    status.textContent = "Could not change site access. Try again.";
  } finally {
    await updateAccess();
    detection.disabled = false;
  }
});
void updateAccess();
