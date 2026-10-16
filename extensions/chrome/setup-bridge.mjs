export function allowedSetupSender(sender, origin) {
  try {
    const url = new URL(sender.url);
    return url.origin === origin && url.pathname === "/extension/setup" && sender.origin === origin &&
      Number.isInteger(sender.tab?.id) && sender.frameId === 0 && Boolean(sender.documentId);
  } catch { return false; }
}

export function createSetupBridge({ origin, api, connect, busy, setBusy, random, sameApplication, version }) {
  const proofs = new Map();
  return async (message, sender) => {
    if (!allowedSetupSender(sender, origin) || !message || JSON.stringify(message).length > 1000) throw new Error("Open extension setup in ApplyOverflow.");
    const key = `${sender.tab.id}:${sender.documentId}`;
    if (message.action === "setup-ping") {
      for (const [key, proof] of proofs) if (proof.expires < Date.now()) proofs.delete(key);
      if (proofs.size >= 20) proofs.clear();
      const nonce = random();
      proofs.set(key, { nonce, expires: Date.now() + 10 * 60_000 });
      return { protocol: 2, nonce, version };
    }
    const proof = proofs.get(key);
    if (!proof || proof.expires < Date.now() || message.nonce !== proof.nonce) throw new Error("Setup connection changed. Check again.");
    if (!["setup-check", "setup-connect", "setup-return"].includes(message.action)) throw new Error("Unsupported setup action.");
    if (busy()) throw new Error("Another extension action is running. Wait for it to finish.");
    if (message.action === "setup-connect") {
      delete proof.verifiedToken;
      setBusy("connect");
      try { await connect(); return { connected: true }; }
      finally { setBusy(null); }
    }
    const { connection } = await chrome.storage.local.get("connection");
    if (!connection?.token || connection.origin !== origin || Date.parse(connection.expiresAt) <= Date.now()) return { connected: false };
    if (message.action === "setup-check") {
      if (!/^[A-Za-z0-9_-]{43}$/.test(message.challenge ?? "")) throw new Error("Invalid connection check.");
      delete proof.verifiedToken;
      const result = await api("setup-check", { challenge: message.challenge }, connection.token);
      if (result.matched === true) proof.verifiedToken = connection.token;
      return { connected: true };
    }
    if (proof.verifiedToken !== connection.token) throw new Error("Check that the extension is connected to this account before returning.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(message.context ?? "")) throw new Error("Open your application and use the Chrome toolbar.");
    const storageKey = `setup-return:${message.context}`;
    const binding = (await chrome.storage.session.get(storageKey))[storageKey];
    if (!binding || binding.ownerTabId !== sender.tab.id || binding.expires <= Date.now()) throw new Error("The original application is no longer available. Open it and use the toolbar.");
    if (binding.account && binding.account !== connection.email) throw new Error("The account changed during setup. Open your application and use the toolbar to continue with this account.");
    const tab = await chrome.tabs.get(binding.tabId).catch(() => null);
    if (!tab || !sameApplication(tab.url, binding.url)) throw new Error("The application tab closed or changed. Open an application and use the toolbar.");
    // Focusing a tab never injects, fills, uploads, reloads or submits anything.
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.storage.session.remove(storageKey);
    return { returned: true };
  };
}
