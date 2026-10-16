import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedSetupSender, createSetupBridge } from "../extensions/chrome/setup-bridge.mjs";

const origin = "https://applyoverflow.com";
const sender = { url: `${origin}/extension/setup`, origin, frameId: 0, documentId: "setup-document", tab: { id: 2 } };
test("setup bridge is restricted to the exact first-party top-frame document", () => {
  assert.equal(allowedSetupSender(sender, origin), true);
  for (const patch of [{ url: `${origin}/applications/auto` }, { url: `${origin}/extension/setup/other` }, { frameId: 1 }, { origin: "https://other.invalid" }, { documentId: undefined }, { tab: {} }])
    assert.equal(allowedSetupSender({ ...sender, ...patch }, origin), false);
});
test("nonce/account-bound return never reloads, navigates or fills the application", async () => {
  let connection = { origin, token: "fixture-credential", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  let matched = true, active = false, connected = 0;
  const actions = [];
  const context = "c".repeat(43), nonce = "n".repeat(43);
  const binding = { ownerTabId: 2, tabId: 1, url: "https://employer.invalid/apply/1", expires: Date.now() + 60_000 };
  let tab = { id: 1, windowId: 3, url: binding.url };
  globalThis.chrome = {
    storage: { local: { get: async () => ({ connection }) }, session: { get: async key => ({ [key]: binding }), remove: async key => actions.push(["remove", key]) } },
    tabs: { get: async () => tab, update: async (...args) => actions.push(["focus-tab", ...args]) },
    windows: { update: async (...args) => actions.push(["focus-window", ...args]) },
  };
  const bridge = createSetupBridge({ origin, api: async () => ({ matched }), connect: async () => { connected++; },
    busy: () => active, setBusy: value => { active = Boolean(value); }, random: () => nonce, sameApplication: (a, b) => a === b, version: "0.16.0" });
  try {
    assert.deepEqual(await bridge({ action: "setup-ping" }, sender), { nonce, protocol: 2, version: "0.16.0" });
    await assert.rejects(bridge({ action: "setup-connect", nonce: "wrong" }, sender), /Check again/);
    await assert.rejects(bridge({ action: "setup-connect", nonce }, { ...sender, documentId: "reloaded" }), /Check again/);
    await assert.rejects(bridge({ action: "workspace-fill", nonce }, sender), /Unsupported/);
    active = true;
    await assert.rejects(bridge({ action: "setup-connect", nonce }, sender), /running/);
    active = false;
    await bridge({ action: "setup-connect", nonce }, sender);
    assert.equal(connected, 1);
    await assert.rejects(bridge({ action: "setup-return", nonce, context }, sender), /Check that/);
    matched = false;
    await bridge({ action: "setup-check", nonce, challenge: context }, sender);
    await assert.rejects(bridge({ action: "setup-return", nonce, context }, sender), /Check that/);
    matched = true;
    const reply = await bridge({ action: "setup-check", nonce, challenge: context }, sender);
    assert.deepEqual(reply, { connected: true }, "no credentials cross the website bridge");
    connection = { ...connection, token: "switched-account" };
    await assert.rejects(bridge({ action: "setup-return", nonce, context }, sender), /Check that/);
    await bridge({ action: "setup-check", nonce, challenge: context }, sender);
    tab = { ...tab, url: "https://employer.invalid/apply/2" };
    await assert.rejects(bridge({ action: "setup-return", nonce, context }, sender), /closed or changed/);
    assert.deepEqual(actions, []);
    tab.url = binding.url;
    assert.deepEqual(await bridge({ action: "setup-return", nonce, context }, sender), { returned: true });
    assert.deepEqual(actions, [["focus-tab", 1, { active: true }], ["focus-window", 3, { focused: true }], ["remove", `setup-return:${context}`]]);
  } finally { delete globalThis.chrome; }
});
