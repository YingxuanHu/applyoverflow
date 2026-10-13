export function allowedWorkspaceSender(sender, origin) {
  try {
    const url = new URL(sender.url);
    return url.origin === origin && url.pathname === "/applications/auto-apply" &&
      sender.tab?.id != null && sender.frameId === 0 && Boolean(sender.documentId) && sender.origin === origin;
  } catch { return false; }
}

export function createWorkspaceBridge({ origin, api, inspect, inspectActive, handle, sameApplication, busy, setBusy, version }) {
  return async (message, sender) => {
    if (!allowedWorkspaceSender(sender, origin)) throw new Error("Open Auto Apply in ApplyOverflow to continue.");
    if (message?.action === "ping") return { version, protocol: 1 };
    const actions = ["open", "snapshot", "fill", "edit", "check", "submit", "focus", "cancel"];
    if (!actions.includes(message?.action) || typeof message.token !== "string" || message.token.length > 6000) throw new Error("Invalid workspace request.");
    const { connection } = await chrome.storage.local.get("connection");
    if (!connection?.token || connection.origin !== origin || Date.parse(connection.expiresAt) <= Date.now()) throw new Error("Connect the extension to this ApplyOverflow account in Settings, then retry.");
    const target = await api("workspace-target", { token: message.token }, connection.token);
    const key = `workspace:${target.id}`;
    if (busy()) throw new Error("Another application action is running. Wait for it to finish.");
    setBusy(`workspace-${message.action}`);
    try {
      let binding = (await chrome.storage.session.get(key))[key];
      if (message.action === "open") {
        if (target.status !== "PREPARING") throw new Error("This application is already recorded as submitted.");
        let tab;
        if (binding?.url === target.url) tab = await chrome.tabs.get(binding.tabId).catch(() => null);
        if (tab && !sameApplication(tab.url, target.url)) tab = null;
        if (!tab) tab = await chrome.tabs.create({ url: target.url, active: false });
        binding = { tabId: tab.id, url: target.url, nonce: target.nonce, ownerTabId: sender.tab.id, ownerDocumentId: sender.documentId };
        await chrome.storage.session.set({ [key]: binding });
        return { opened: true, message: "Employer tab opened. Prepare when the form has loaded." };
      }
      if (!binding || binding.nonce !== target.nonce || binding.ownerTabId !== sender.tab.id || binding.ownerDocumentId !== sender.documentId)
        throw new Error("Reopen the employer tab from this workspace before continuing.");
      const tab = await chrome.tabs.get(binding.tabId).catch(() => null);
      if (!tab || !sameApplication(tab.url, target.url)) throw new Error("The employer tab closed or changed to another application. Reopen it from this workspace.");
      if (message.action === "focus") { await chrome.tabs.update(tab.id, { active: true }); return { message: "Employer form opened." }; }
      if (!(await chrome.permissions.contains({ origins: [`${new URL(tab.url).origin}/*`] })))
        throw new Error("Site access is needed. Open the employer tab, click the extension, and enable it on this site. Then return here and retry.");
      // Only this explicit binding can override the toolbar's active tab.
      const toolbar = { url: chrome.runtime.getURL("popup.html") };
      if (message.action === "cancel") return await handle("submission-cancel", toolbar, {}, tab);
      if (target.status !== "PREPARING" && !["snapshot"].includes(message.action)) throw new Error("This application has already been submitted. No repeat submission is allowed.");
      if (message.action === "fill") {
        const result = await handle("autofill", toolbar, {}, tab);
        if (result.error || result.reconnect || result.connected === false) throw new Error(result.error || result.message || "Reconnect the extension.");
        return { ...result, review: await snapshot(tab), message: result.message };
      }
      if (message.action === "snapshot") return { review: await snapshot(tab) };
      if (message.action === "edit") {
        await handle("submission-cancel", toolbar, {}, tab);
        const scan = await inspectActive(tab);
        const review = (await inspect({ tabId: tab.id, documentIds: [scan.documentId] }, ["workspace-edit", {
          id: message.id, value: message.value, revision: message.revision,
        }, scan.result.url])).result;
        if (review.error) throw new Error(review.error);
        return { review, message: "Answer updated on the employer form." };
      }
      if (message.action === "check") return await handle("submission-preview", toolbar, {}, tab);
      if (message.action === "submit") {
        if (message.confirmed !== true || message.documentsReviewed !== true) throw new Error("Review the employer form and documents before approving this application.");
        return await handle("submission-commit", toolbar, { token: message.approvalToken, confirmed: true, documentsReviewed: true }, tab);
      }
    } finally { setBusy(null); }
  };
  async function snapshot(tab) {
    const scan = await inspectActive(tab);
    const review = (await inspect({ tabId: tab.id, documentIds: [scan.documentId] }, ["workspace-review", {}, scan.result.url])).result;
    if (review.error) throw new Error(review.error);
    return review;
  }
}
