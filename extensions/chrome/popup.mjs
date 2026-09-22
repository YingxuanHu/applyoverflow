import { APP_ORIGIN, BUILD_ID } from "./config.mjs";
import { SITE_ORIGINS } from "./sites.mjs";
import { createQuestionReview } from "./question-review.mjs";
import { questionAssistance } from "./question-policy.mjs";
const renderQuestions = createQuestionReview(questionAssistance);
const status = document.getElementById("status");
function clearQuestions() {
  renderQuestions(document.getElementById("remaining-fields"), [], run);
  document.getElementById("completed-list").replaceChildren();
  document.getElementById("fill-progress").hidden = true;
}
document.getElementById("profile").href = `${APP_ORIGIN}/profile`;
document.getElementById("settings").href = `${APP_ORIGIN}/settings/extension`;
document.getElementById("privacy").href = `${APP_ORIGIN}/extension/privacy`;
let history, preview;
let activeAction = null;
let refreshTimer;
let needsReload = false;
function checkVersion(result) {
  if (!result) throw new Error("Open ApplyOverflow from the Chrome toolbar and try again.");
  activeAction = result.activeAction ?? null;
  needsReload = result.buildId !== BUILD_ID;
  document.getElementById("reload-extension").hidden = !needsReload;
  if (needsReload) throw new Error("An extension update is ready. Reload the extension, then reopen it. Your form has not been changed.");
}
function showFields(fields) {
  const pending = fields.filter(field => field.state === "needed");
  document.getElementById("fill-progress").hidden = false;
  document.getElementById("progress-heading").textContent = pending.length ? `${pending.length} to review` : "Supported fields complete";
  renderQuestions(document.getElementById("remaining-fields"), fields, run);
  document.getElementById("completed-list").replaceChildren(...fields.filter(field => field.state !== "needed").map(field => {
    const item = document.createElement("li"); item.textContent = `${field.label.replace(/[*]/g, "").trim()}: ${field.state === "filled" ? "Filled" : "Kept"}`; return item;
  }));
}
async function run(type, data = {}) {
  clearTimeout(refreshTimer);
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
    // Check even after initial load: an unpacked build may have changed while
    // this popup was open. Older workers must never receive the mutation first.
    if (type !== "status") {
      const ready = await chrome.runtime.sendMessage({ type: "version", buildId: BUILD_ID });
      checkVersion(ready);
      if (activeAction) throw new Error(ready.message || "Finishing the previous action. Please wait.");
    }
    const result = await chrome.runtime.sendMessage({ type, ...data, buildId: BUILD_ID });
    checkVersion(result);
    if (result.reconnect) {
      clearQuestions();
      document.getElementById("connection-state").textContent = "Reconnect needed";
      history = preview = undefined;
      document.getElementById("history-entry").replaceChildren();
      document.getElementById("history-picker").hidden = true;
      document.getElementById("applied-confirmation").hidden = true;
      document.getElementById("connect").hidden = false;
      document.getElementById("actions").hidden = true;
      document.getElementById("disconnect").hidden = true;
      document.getElementById("account").hidden = true;
    }
    if (result.error) throw new Error(result.error);
    if (result.fields) showFields(result.fields);
    if (result.history) {
      history = result.history;
      const select = document.getElementById("history-entry");
      select.replaceChildren(
        ...history.entries.map(
          (entry, index) => new Option(entry.label, String(index)),
        ),
      );
      document.getElementById("history-picker").hidden =
        !history.entries.length;
      if (!history.entries.length)
        result.message = "Add work or education entries to your profile first.";
    }
    if (result.preview) {
      preview = result.preview;
      document.getElementById("applied-company").value = preview.company;
      document.getElementById("applied-title").value = preview.title;
      document.getElementById("applied-domain").textContent = new URL(
        preview.url,
      ).hostname;
      document.getElementById("applied-check").checked = false;
      document.getElementById("applied-confirmation").hidden = false;
    }
    if (type === "applied" || !result.connected) {
      preview = undefined;
      document.getElementById("applied-confirmation").hidden = true;
    }
    if (!result.connected) {
      clearQuestions();
      history = undefined;
      document.getElementById("history-entry").replaceChildren();
      document.getElementById("history-picker").hidden = true;
    }
    if (result.email !== undefined) {
      document.getElementById("account").textContent = result.email;
      document.getElementById("account").hidden = !result.email;
    }
    if (!result.connected) document.getElementById("account").hidden = true;
    document.getElementById("connection-state").textContent = result.connected
      ? "Connected"
      : "Not connected";
    if (result.pageMessage !== undefined) {
      document.getElementById("page-status").textContent = result.pageMessage;
      document.getElementById("page-status").hidden = false;
    }
    document.getElementById("connect").hidden = result.connected;
    document.getElementById("actions").hidden = !result.connected;
    document.getElementById("disconnect").hidden = !result.connected;
    if (result.undoAvailable !== undefined)
      document.getElementById("undo").hidden = !result.undoAvailable;
    if (result.autofillUndoAvailable !== undefined)
      document.getElementById("autofill-undo").hidden = !result.autofillUndoAvailable && !result.historyUndoAvailable;
    if (!result.connected) document.getElementById("fill-progress").hidden = true;
    if (result.historyUndoAvailable !== undefined)
      document.getElementById("undo-history").hidden =
        !result.historyUndoAvailable;
    status.textContent = result.message;
    return result;
  } catch (error) {
    status.textContent = error.message || "Could not complete the action.";
  } finally {
    for (const button of document.querySelectorAll("button"))
      button.disabled = needsReload ? button.id !== "reload-extension" : Boolean(activeAction);
    // A popup can close while Chrome opens consent. A reopened popup must
    // reflect that operation and recover when its window is closed.
    if (activeAction && !needsReload) refreshTimer = setTimeout(() => void run("status"), 1500);
  }
}
for (const type of [
  "connect",
  "fill",
  "autofill-undo",
  "resume",
  "disconnect",
  "undo",
  "history",
  "undo-history",
  "applied-preview",
])
  document.getElementById(type).addEventListener("click", () => void run(type === "fill" ? "autofill" : type));
void run("status");
document.getElementById("reload-extension").addEventListener("click", () => chrome.runtime.reload());
document.getElementById("fill-history").addEventListener("click", () => {
  const entry =
    history?.entries[Number(document.getElementById("history-entry").value)];
  if (entry)
    void run("fill-history", {
      selection: {
        kind: entry.kind,
        index: entry.index,
        revision: history.revision,
      },
    });
});
document
  .getElementById("applied-confirmation")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    if (preview && document.getElementById("applied-check").checked)
      void run("applied", {
        token: preview.token,
        title: document.getElementById("applied-title").value,
        company: document.getElementById("applied-company").value,
        confirmed: true,
      });
  });
document.getElementById("cancel-applied").addEventListener("click", () => {
  preview = undefined;
  document.getElementById("applied-confirmation").hidden = true;
});
const detection = document.getElementById("detection");
async function updateAccess() {
  const permissions = await chrome.permissions.getAll();
  const count = SITE_ORIGINS.filter((origin) =>
    permissions.origins?.includes(origin),
  ).length;
  detection.checked = count === SITE_ORIGINS.length;
  detection.indeterminate = count > 0 && count < SITE_ORIGINS.length;
  document.getElementById("access-state").textContent = !count
    ? "Toolbar only"
    : detection.checked
      ? "Supported sites enabled"
      : "Some sites enabled";
  document.getElementById("access-help").textContent = count
    ? "Greenhouse, Lever, Ashby, Workday, iCIMS & Workable. Other application sites: use the toolbar."
    : "Automatic hints are off until site access is granted. Filling always requires your click.";
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
