// Recovery is chosen locally, never from a server-provided URL or command.
export function recoveryForError(error = {}, action = "autofill") {
  const status = Number(error.status) || 0;
  const code = error.code || "";
  const retryFill = action.startsWith("autofill") || action === "resume-default";
  const retry = { type: retryFill ? "autofill" : "status", label: retryFill ? "Retry Autofill" : "Check again" };
  let recovery;
  if (status === 401 || error.reconnect || code === "SIGN_IN_REQUIRED") {
    recovery = { code: "SIGN_IN_REQUIRED", title: "Reconnect your profile", message: "Your ApplyOverflow connection expired or was revoked. Sign in again, then click Autofill. Answers already on the form will stay unchanged.", actions: [{ type: "connect", label: "Sign in to ApplyOverflow" }] };
  } else if (code === "PROFILE_REQUIRED" || code === "RESUME_SHARING_DISABLED" || code === "RESUME_REQUIRED") {
    recovery = { code, title: code === "PROFILE_REQUIRED" ? "Complete your profile" : "Check resume sharing", message: error.message, actions: [{ type: "open-profile", label: "Open Profile" }, retry] };
  } else if (status === 429) {
    const seconds = Math.min(300, Math.max(1, Number(error.retryAfter) || 60));
    recovery = { code: "RATE_LIMITED", title: "Autofill is temporarily limited", message: `Wait ${seconds} seconds, then retry. Your connection and existing answers are unchanged.`, actions: [retry] };
  } else if (status === 409) {
    recovery = { code: "PROFILE_CHANGED", title: "Your saved information changed", message: "Retry Autofill to use your latest profile. Existing form answers will stay unchanged.", actions: [retry] };
  } else if (status === 400 || status === 413 || code === "EXTENSION_REQUEST_INVALID") {
    recovery = { code: "EXTENSION_REQUEST_INVALID", title: "Autofill request rejected", message: "ApplyOverflow could not accept the extension's form data. This is not a sign-in problem. Check for an extension update, then retry. Keep any manual answers before refreshing the application page.", actions: [{ type: "extension-help", label: "Check extension update" }, retry] };
  } else if (status === 403) {
    recovery = { code: "ACCESS_DENIED", title: "This request is not permitted", message: error.message || "Check your extension connection and sharing permissions in ApplyOverflow settings.", actions: [{ type: "extension-help", label: "Open extension settings" }] };
  } else if (code === "PAGE_OUTDATED" || /context invalidated|receiving end does not exist|older Autofill version|extension update is ready/i.test(error.message || "")) {
    recovery = { code: "PAGE_OUTDATED", title: "This tab needs the updated extension", message: "Keep any manual answers, then refresh this application page. If it still fails, reload ApplyOverflow in Chrome's extension settings.", actions: [{ type: "chrome-extensions", label: "Open Chrome extensions" }] };
  } else if (status >= 500 || status === 404 || code === "INVALID_RESPONSE") {
    recovery = { code: "SERVICE_UNAVAILABLE", title: "ApplyOverflow is temporarily unavailable", message: "The server could not complete this step. Retry shortly; you do not need to sign out. Existing form answers are unchanged.", actions: [retry] };
  } else if (["TimeoutError", "AbortError"].includes(error.name)) {
    recovery = { code: "REQUEST_TIMEOUT", title: "ApplyOverflow took too long to respond", message: "This step timed out. Check your connection and retry. Fields already filled will be kept.", actions: [retry] };
  } else if (code === "NETWORK_ERROR" || error.name === "TypeError") {
    recovery = { code: "NETWORK_ERROR", title: "Cannot reach ApplyOverflow", message: "Check your internet connection and whether applyoverflow.com opens, then retry. Your sign-in has not been removed.", actions: [retry, { type: "extension-help", label: "Open ApplyOverflow" }] };
  } else if (action === "connect") {
    recovery = { code: "CONNECTION_INCOMPLETE", title: "Connection not completed", message: error.message || "The sign-in window did not complete. Try connecting again.", actions: [{ type: "connect", label: "Connect to ApplyOverflow" }] };
  } else {
    recovery = { code: "AUTOFILL_STOPPED", title: "Autofill stopped", message: error.message || "Check that the application page has finished loading, then retry. Existing form answers will be kept.", actions: [retry] };
  }
  const stage = ["autofill-plan", "autofill-suggest", "resume-default", "connection-status", "token"].includes(action) ? action : "autofill";
  const fields = Array.isArray(error.fields) ? error.fields.filter(field => /^(url|questions|history|employmentCountry|employmentLocation|label|options|maxLength|maxWords|revision|request)(\.\d+)?$/.test(field)).slice(0, 4) : [];
  const detail = [recovery.code, `Step: ${stage}`, status ? `HTTP ${status}` : "", fields.length ? `Fields: ${fields.join(", ")}` : "",
    /^[a-zA-Z0-9-]{8,64}$/.test(error.requestId || "") ? `Reference: ${error.requestId}` : ""].filter(Boolean).join(" | ");
  return { ...recovery, detail };
}

export function stoppedFields(fields = []) {
  return fields.map(field => ({ ...field, queued: false, processing: false,
    ...(field.state === "needed" ? {
      blocked: true, reason: "Not processed because Autofill stopped. Use the recovery action above, then retry.",
    } : {}) }));
}

export function planQuestions(scan) {
  const labels = scan.fields ? scan.fields.filter(field => !field.profileKey && field.canAnswer && field.state === "needed").map(field => field.label) : scan.questions || [];
  const result = [];
  let bytes = 0;
  for (const label of new Set(labels)) {
    if (typeof label !== "string" || !label.trim() || label.length > 500) continue;
    const size = new TextEncoder().encode(JSON.stringify(label)).length + 1;
    if (bytes + size > 18_000 || result.length >= 40) continue;
    result.push(label); bytes += size;
  }
  return result;
}

// Also serialized into the isolated on-page assistant. Do not capture imports.
export function createRecoveryView() {
  const allowed = new Set(["connect", "autofill", "status", "extension-help", "chrome-extensions", "open-profile"]);
  const previous = new WeakMap();
  return (container, recovery, run) => {
    const signature = JSON.stringify(recovery || null);
    if (previous.get(container) === signature) return;
    previous.set(container, signature);
    container.replaceChildren();
    container.hidden = !recovery;
    if (!recovery) return;
    container.setAttribute("role", "alert");
    const title = document.createElement("strong"); title.textContent = recovery.title;
    const message = document.createElement("p"); message.textContent = recovery.message;
    container.append(title, message);
    for (const action of recovery.actions || []) {
      if (!allowed.has(action.type)) continue;
      const button = document.createElement("button"); button.type = "button";
      button.className = "secondary"; button.textContent = action.label;
      button.addEventListener("click", event => { if (event.isTrusted) void run(action.type); });
      container.append(button);
    }
    if (recovery.detail) {
      const details = document.createElement("details"), summary = document.createElement("summary"), text = document.createElement("p");
      summary.textContent = "Technical details"; text.textContent = recovery.detail;
      details.append(summary, text); container.append(details);
    }
  };
}
