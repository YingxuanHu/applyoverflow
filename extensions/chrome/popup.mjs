import { APP_ORIGIN } from "./config.mjs";
import { SITE_ORIGINS } from "./sites.mjs";
const status = document.getElementById("status");
document.getElementById("profile").href = `${APP_ORIGIN}/profile`;
document.getElementById("settings").href = `${APP_ORIGIN}/settings/extension`;
document.getElementById("privacy").href = `${APP_ORIGIN}/extension/privacy`;
let history, preview;
let activeAction = null;
let refreshTimer;
function showFields(fields) {
  const pending = fields.filter(field => field.state === "needed");
  document.getElementById("fill-progress").hidden = false;
  document.getElementById("progress-heading").textContent = pending.length ? `${pending.length} to review` : "Supported fields complete";
  const container = document.getElementById("remaining-fields");
  container.replaceChildren();
  for (const field of pending) {
    const disclosure = document.createElement("details"); disclosure.className = "pending-field";
    const summary = document.createElement("summary"); summary.textContent = `${field.title || field.label}${field.required ? " *" : ""}`;
    disclosure.append(summary);
    const row = document.createElement("form");
    row.className = "answer-row";
    const label = document.createElement("label");
    label.className = "answer-label";
    label.textContent = `${field.label}${field.required ? " *" : ""}`;
    const jump = document.createElement("button");
    jump.type = "button"; jump.className = "field-link"; jump.textContent = "Show on page";
    jump.addEventListener("click", () => void run("autofill-focus", { id: field.id, label: field.label }));
    row.append(label);
    if (field.canAnswer) {
      const control = document.createElement(field.options?.length ? "select" : field.profileKey ? "input" : "textarea");
      control.id = `answer-${field.id}`; label.htmlFor = control.id;
      control.required = true;
      if (control instanceof HTMLSelectElement) control.replaceChildren(new Option("Choose an answer", ""), ...field.options.map(option => new Option(option, option)));
      else if (control instanceof HTMLTextAreaElement) { control.rows = 2; control.maxLength = 3000; }
      else { control.type = field.profileKey === "email" ? "email" : field.profileKey === "phone" ? "tel" : /Url$/.test(field.profileKey) ? "url" : "text"; control.maxLength = 500; }
      row.append(control);
      const remember = document.createElement("input"); remember.type = "checkbox";
      if (field.canRemember) {
        const rememberLabel = document.createElement("label"); rememberLabel.className = "remember-answer";
        rememberLabel.append(remember, document.createTextNode(field.profileKey ? "Save to my profile" : "Reuse for this question at this employer"));
        row.append(rememberLabel);
      }
      const submit = document.createElement("button"); submit.type = "submit"; submit.className = "secondary"; submit.textContent = "Fill answer";
      row.append(submit);
      row.addEventListener("submit", event => {
        event.preventDefault();
        void run("autofill-answer", { id: field.id, label: field.label, answer: control.value, remember: remember.checked });
      });
    } else {
      const reason = document.createElement("p"); reason.className = "sites";
      reason.textContent = field.reason || "Complete this field on the employer form."; row.append(reason);
    }
    row.append(jump); disclosure.append(row); container.append(disclosure);
  }
  document.getElementById("completed-list").replaceChildren(...fields.filter(field => field.state !== "needed").map(field => {
    const item = document.createElement("li"); item.textContent = `${field.label}: ${field.state === "filled" ? "Filled" : "Kept"}`; return item;
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
    const result = await chrome.runtime.sendMessage({ type, ...data });
    if (!result)
      throw new Error(
        "Open ApplyOverflow from the Chrome toolbar and try again.",
      );
    activeAction = result.activeAction ?? null;
    if (result.reconnect) {
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
  } catch (error) {
    status.textContent = error.message || "Could not complete the action.";
  } finally {
    for (const button of document.querySelectorAll("button"))
      button.disabled = Boolean(activeAction);
    // A popup can close while Chrome opens consent. A reopened popup must
    // reflect that operation and recover when its window is closed.
    if (activeAction) refreshTimer = setTimeout(() => void run("status"), 1500);
  }
}
for (const type of [
  "connect",
  "fill",
  "autofill-undo",
  "review",
  "resume",
  "disconnect",
  "undo",
  "history",
  "undo-history",
  "applied-preview",
])
  document.getElementById(type).addEventListener("click", () => void run(type === "fill" ? "autofill" : type));
void run("status");
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
