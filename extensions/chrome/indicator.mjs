// Serialized into a classic content script at build time; no module fetches.
export function installIndicator(buildId) {
  if (globalThis.__applyOverflowIndicator) return;
  let host,
    root,
    view,
    timer,
    busy = false,
    stopped = false,
    expanded = false;
  let lastUrl = location.href,
    dismissedUrl = "",
    connection = false;
  let enabled = false,
    lastScan = 0,
    notice = "",
    noticeUntil = 0;
  let remaining = [];
  const inspect = globalThis.__applyOverflowInspect;
  const send = (type, data = {}) => chrome.runtime.sendMessage({ type, buildId, ...data });
  const remove = () => {
    host?.remove();
    host = root = view = undefined;
  };
  function stop() {
    stopped = true;
    clearTimeout(timer);
    clearInterval(navigation);
    observer.disconnect();
    remove();
    document.removeEventListener("input", schedule, true);
    document.removeEventListener("change", schedule, true);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("popstate", resume);
    chrome.runtime.onMessage.removeListener(onMessage);
    delete globalThis.__applyOverflowIndicator;
  }
  globalThis.__applyOverflowIndicator = { stop };
  function button(label, action, secondary = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    if (secondary) element.className = "secondary";
    element.disabled = busy;
    element.addEventListener("click", (event) => {
      if (event.isTrusted) action();
    });
    return element;
  }
  async function run(type, data = {}) {
    if (busy) return;
    busy = true;
    notice =
      type === "connect"
        ? "Connect in the ApplyOverflow window..."
        : type === "resume"
          ? "Choose and approve a resume in ApplyOverflow..."
          : "Working...";
    noticeUntil = Date.now() + 120_000;
    await scan();
    const atUrl = location.href;
    try {
      const response = await send(type, data);
      if (location.href !== atUrl) return;
      if (!response)
        throw new Error(
          "Reload the extension in Chrome, then refresh this application page.",
        );
      if (response.reconnect || response.connected === false)
        connection = false;
      if (response.error) throw new Error(response.error);
      connection = response.connected;
      notice = response.message;
      if (response.fields) {
        remaining = response.fields.filter(field => field.state === "needed");
        renderRemaining();
      }
    } catch (error) {
      notice = error.message || "Open the extension from Chrome to retry.";
    } finally {
      busy = false;
      noticeUntil = Date.now() + 15_000;
      await scan();
      setTimeout(schedule, 15_100);
    }
  }
  function renderRemaining() {
    if (!view) return;
    const openFields = new Set([...view.remaining.querySelectorAll("details[open]")].map(item => item.dataset.id));
    view.remaining.replaceChildren();
    view.remaining.hidden = !remaining.length;
    const heading = document.createElement("summary");
    heading.textContent = `${remaining.length} remaining ${remaining.length === 1 ? "field" : "fields"}`;
    view.remaining.append(heading);
    for (const field of remaining) {
      const disclosure = document.createElement("details");
      disclosure.dataset.id = field.id; disclosure.open = openFields.has(field.id);
      const label = document.createElement("summary"); label.textContent = `${field.title || field.label}${field.required ? " *" : ""}`;
      disclosure.append(label);
      if (field.canAnswer) {
        if (field.kind === "combobox" && !field.options?.length)
          disclosure.append(button("Load choices", () => void run("autofill-options", { id: field.id, label: field.label }), true));
        const form = document.createElement("form");
        const control = document.createElement(field.options?.length ? "select" : "textarea");
        control.setAttribute("aria-label", field.label); control.required = true;
        if (field.options?.length) control.replaceChildren(new Option("Choose an answer", ""), ...field.options.map(option => new Option(option, option)));
        else { control.rows = 2; control.maxLength = 3000; }
        form.append(control);
        const remember = document.createElement("input"); remember.type = "checkbox";
        if (field.canRemember) {
          const rememberLabel = document.createElement("label"); rememberLabel.className = "remember";
          rememberLabel.append(remember, document.createTextNode(field.profileKey ? "Save to my profile" : "Remember for this employer and question"));
          form.append(rememberLabel);
        }
        const fill = document.createElement("button"); fill.type = "submit"; fill.textContent = "Fill answer";
        form.append(fill);
        form.addEventListener("submit", event => {
          event.preventDefault();
          if (event.isTrusted) void run("autofill-answer", { id: field.id, label: field.label, answer: control.value, remember: remember.checked });
        });
        disclosure.append(form);
      } else {
        const reason = document.createElement("p"); reason.textContent = field.reason || "Complete this field on the form.";
        disclosure.append(reason);
      }
      disclosure.append(button("Show on page", () => void run("autofill-focus", { id: field.id, label: field.label }), true));
      view.remaining.append(disclosure);
    }
  }
  function render(result) {
    if (!host?.isConnected) {
      host = document.createElement("div");
      host.id = "applyoverflow-assistant";
      // A tall cross-origin iframe's bottom can be far below the parent viewport.
      // Keep its entry point in normal flow, without covering employer fields.
      const embedded = window !== window.top;
      host.style.cssText = embedded
        ? "all:initial;position:sticky;top:12px;z-index:2147483646;display:block;width:fit-content;max-width:calc(100% - 32px);margin:12px 16px 12px auto"
        : "all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483646;display:block;max-width:calc(100vw - 32px)";
      root = host.attachShadow({ mode: "open" });
      if (embedded) document.body.prepend(host);
      else document.documentElement.append(host);
      const style = document.createElement("style");
      style.textContent = `:host{color-scheme:light dark}*{box-sizing:border-box}section{font:13px/1.5 system-ui,sans-serif;letter-spacing:0;color:#202124;background:#fff;border:1px solid #dce0e6;border-radius:8px;box-shadow:0 3px 14px #0002;max-width:300px}header{display:flex;align-items:center;gap:8px;padding:6px}strong{font-size:13px;margin:0 8px}button{font:inherit;border:0;border-radius:5px;min-height:36px;padding:7px 10px;cursor:pointer;color:#fff;background:#087cf0}button:focus-visible{outline:2px solid #087cf0;outline-offset:2px}button:disabled{opacity:.55;cursor:wait}.secondary,.close{color:inherit;background:transparent}.close{margin-left:auto;font-size:18px;min-width:36px}.content{padding:0 12px 12px}.content button{width:100%;margin-top:6px}.content p{margin:6px 0;color:#656872;overflow-wrap:anywhere}.launcher{background:transparent;color:inherit;text-align:left}.dot{display:inline-block;background:#087cf0;width:8px;height:8px;border-radius:50%;margin-right:8px}@media(prefers-color-scheme:dark){section{background:#232325;color:#f5f5f7;border-color:#4b4b51}.content p{color:#b7bac2}}`;
      root.append(style);
      const fieldsStyle = document.createElement("style");
      fieldsStyle.textContent = `.content{max-height:65vh;overflow:auto;overscroll-behavior:contain}details{margin-top:8px}summary{cursor:pointer;padding:5px 0}details details{border-top:1px solid #8885}textarea,select{font:inherit;width:100%;max-width:100%;margin-top:6px;padding:6px;border:1px solid #8888;border-radius:4px;background:transparent;color:inherit}.remember{display:flex;align-items:start;gap:6px;margin-top:8px}.remember input{flex:none}`;
      root.append(fieldsStyle);
      const section = document.createElement("section");
      section.setAttribute("aria-label", "ApplyOverflow application assistant");
      const header = document.createElement("header");
      const brand = document.createElement("strong");
      brand.textContent = "ApplyOverflow";
      header.append(brand);
      const launcher = button("Autofill available", () => {
        expanded = true;
        void scan();
      });
      launcher.className = "launcher";
      launcher.setAttribute("aria-expanded", "false");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");
      launcher.prepend(dot);
      const launcherLabel = launcher.lastChild;
      header.append(launcher);
      const close = button("\u00d7", () => {
        dismissedUrl = location.href;
        remove();
      });
      close.className = "close";
      close.disabled = false;
      close.title = "Dismiss for this page";
      close.setAttribute("aria-label", close.title);
      header.append(close);
      section.append(header);
      const content = document.createElement("div");
      content.className = "content";
      const summary = document.createElement("p");
      const connect = button(
        "Connect to ApplyOverflow",
        () => void run("connect"),
      );
      const fill = button("Autofill", () => void run("autofill"));
      const resume = button("Change resume", () => void run("resume"), true);
      const remainingFields = document.createElement("details");
      const undo = button("Undo Autofill", () => void run("autofill-undo"), true);
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      const more = document.createElement("details");
      const moreLabel = document.createElement("summary"); moreLabel.textContent = "More actions";
      more.append(moreLabel, undo);
      content.append(summary, connect, fill, resume, status, remainingFields, more);
      section.append(content);
      root.append(section);
      view = {
        brand,
        launcher,
        launcherLabel,
        content,
        summary,
        connect,
        fill,
        resume,
        remaining: remainingFields,
        more,
        undo,
        status,
      };
      renderRemaining();
    }
    // Preserve DOM identity across scans: replacing a pressed button can swallow
    // the click between pointer-down/up (or Space-down/up for keyboard users).
    const focus = root.activeElement;
    view.brand.hidden = !expanded;
    view.launcher.hidden = expanded;
    view.content.hidden = !expanded;
    view.launcherLabel.textContent =
      result.available || result.resumeAvailable
        ? "Autofill available"
        : "Application help available";
    view.summary.textContent = result.available
      ? "Fill from your ApplyOverflow profile. Existing answers stay unchanged."
      : result.resumeAvailable
        ? "Resume attachment available."
        : result.historyAvailable
          ? "Work and education fields detected. Choose a profile entry in the Chrome toolbar."
          : result.questions.length
            ? "Application questions ready to review."
            : "";
    view.summary.hidden = !view.summary.textContent;
    view.connect.hidden = connection;
    view.fill.hidden = !connection || !(result.available || result.questions.length || result.historyAvailable || result.resumeAvailable);
    view.resume.hidden = !connection || !(result.resumeAvailable || result.resumeDetected);
    view.resume.classList.toggle("secondary", !!result.available);
    view.remaining.hidden = !connection || !remaining.length;
    view.undo.hidden = !result.autofillUndoAvailable && !result.historyUndoAvailable;
    view.more.hidden = view.undo.hidden;
    view.status.hidden = !notice || Date.now() >= noticeUntil;
    if (view.status.textContent !== notice) view.status.textContent = notice;
    for (const action of [
      view.launcher,
      view.connect,
      view.fill,
      view.resume,
      view.undo,
    ])
      action.disabled = busy;
    for (const control of view.remaining.querySelectorAll("button,input,textarea,select")) control.disabled = busy;
    if (expanded && focus?.hidden)
      [...view.content.querySelectorAll("button")]
        .find((action) => !action.hidden && !action.disabled)
        ?.focus({ preventScroll: true });
  }
  let signature = "";
  async function scan() {
    if (
      stopped ||
      !enabled ||
      document.hidden ||
      dismissedUrl === location.href
    )
      return;
    lastScan = performance.now();
    const atUrl = location.href;
    const result = await inspect();
    if (stopped || atUrl !== location.href) return;
    if (
      result.error ||
      (!result.available &&
        !result.resumeAvailable &&
        !result.undoAvailable &&
        !result.autofillUndoAvailable &&
        !result.historyAvailable &&
        !result.historyUndoAvailable &&
        !result.questions.length &&
        !busy &&
        Date.now() >= noticeUntil)
    ) {
      remove();
      signature = "";
      return;
    }
    const next = JSON.stringify([
      result.available,
      result.resumeAvailable,
      result.resumeDetected,
      result.undoAvailable,
      result.historyAvailable,
      result.historyUndoAvailable,
      result.autofillUndoAvailable,
      result.questions.length,
      expanded,
      busy,
      connection,
      notice,
      Date.now() < noticeUntil,
    ]);
    if (next !== signature || !host?.isConnected) {
      signature = next;
      render(result);
    }
  }
  function schedule() {
    if (stopped || !enabled || timer || document.hidden) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void scan();
      },
      Math.max(80, 200 - (performance.now() - lastScan)),
    );
  }
  async function resume() {
    if (stopped || document.hidden) return;
    if (lastUrl !== location.href) {
      lastUrl = location.href;
      notice = "";
      noticeUntil = 0;
      expanded = false;
      remaining = [];
      remove();
    }
    try {
      const result = await send("availability");
      if (!result?.enabled) {
        // Retain the permission-change listener in already injected frames.
        // There is no parent-site permission with which to reinject into them.
        enabled = false;
        remove();
        return;
      }
      enabled = true;
      connection = result.connected;
      schedule();
    } catch {
      stop();
    }
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target !== host &&
          !host?.contains(record.target) &&
          (record.type === "attributes" ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) => node.nodeType === 1 && node !== host,
            )),
      )
    )
      schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "hidden",
      "inert",
      "aria-hidden",
      "disabled",
      "readonly",
      "class",
      "style",
      "id",
      "name",
      "type",
    ],
  });
  document.addEventListener("input", schedule, true);
  document.addEventListener("change", schedule, true);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("popstate", resume);
  // SPA pushState does not emit popstate. Compare URLs only, never poll the DOM.
  const navigation = setInterval(() => {
    if (location.href !== lastUrl) void resume();
  }, 500);
  function onMessage(message) {
    if (["permissions-changed", "connection-changed"].includes(message?.type))
      void resume();
  }
  chrome.runtime.onMessage.addListener(onMessage);
  void resume();
}
