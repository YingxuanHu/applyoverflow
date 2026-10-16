import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { recoveryForError } from "../extensions/chrome/recovery.mjs";
import { applicationContext, detectionOrigins, sameApplication } from "../extensions/chrome/sites.mjs";
import { createWorkspaceBridge, allowedWorkspaceSender } from "../extensions/chrome/workspace-bridge.mjs";
import { createSetupBridge, allowedSetupSender } from "../extensions/chrome/setup-bridge.mjs";

type Message = { type: string; buildId?: string };
type Sender = { id: string; url: string; tab?: { id: number }; frameId?: number; documentId?: string };
type Reply = { buildId?: string; error?: string; activeAction?: string | null; message?: string };
type Listener = (message: Message, sender: Sender, respond: (reply: Reply) => void) => boolean;

function worker() {
  let listener: Listener | undefined;
  let sensitiveCalls = 0;
  let installed: ((details: { reason: string }) => void) | undefined;
  const opened: string[] = [];
  const forbidden = () => { sensitiveCalls++; throw new Error("Unexpected profile access or form mutation"); };
  const event = { addListener: () => {} };
  const chrome = {
    runtime: {
      id: "test-extension", getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      getManifest: () => ({ version: "0.16.0" }),
      onInstalled: { addListener: (callback: typeof installed) => { installed = callback; } }, onStartup: event,
      onMessage: { addListener: (callback: Listener) => { listener = callback; } },
    },
    permissions: { getAll: async () => ({ origins: [] }), onAdded: event, onRemoved: event },
    scripting: { getRegisteredContentScripts: async () => [], executeScript: forbidden },
    tabs: { query: async () => [], onRemoved: event, create: async ({ url }: { url: string }) => { opened.push(url); } },
    storage: { session: { setAccessLevel: forbidden }, local: { setAccessLevel: forbidden } },
  };
  const source = readFileSync(new URL("../extensions/chrome/background.mjs", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "");
  runInNewContext(source, {
    chrome, APP_ORIGIN: "https://applyoverflow.com", BUILD_ID: "current-build",
    detectionOrigins, applicationContext, sameApplication, fetch: forbidden, URL,
    recoveryForError, createWorkspaceBridge, allowedWorkspaceSender,
    createSetupBridge, allowedSetupSender,
  });
  assert.ok(listener);
  return { receive: listener, installed, opened, sensitiveCalls: () => sensitiveCalls };
}

const popup: Sender = { id: "test-extension", url: "chrome-extension://test-extension/popup.html" };
const page: Sender = { id: "test-extension", url: "https://job-boards.greenhouse.io/example/jobs/1", tab: { id: 1 }, frameId: 0, documentId: "document" };

test("stale popup and page mutations fail before profile access or writes", () => {
  const fixture = worker();
  for (const sender of [popup, page]) {
    for (const type of ["autofill", "autofill-answer", "resume", "connect", "undo"]) {
      for (const buildId of [undefined, "old-build"]) {
        let reply: Reply | undefined;
        assert.equal(fixture.receive({ type, buildId }, sender, result => { reply = result; }), false);
        assert.equal(reply?.buildId, "current-build");
        assert.match(reply?.error || "", /updating|older Autofill/);
      }
    }
  }
  assert.equal(fixture.sensitiveCalls(), 0);
});

test("popup version handshake works across builds without scanning forms or reading profiles", async () => {
  const fixture = worker();
  const reply = await new Promise<Reply>(resolve => {
    assert.equal(fixture.receive({ type: "version", buildId: "old-build" }, popup, resolve), true);
  });
  assert.equal(reply.buildId, "current-build");
  assert.equal(reply.activeAction, null);
  assert.equal(fixture.sensitiveCalls(), 0);
});

test("version handshake cannot be requested by a third party or employer page", () => {
  const fixture = worker();
  for (const sender of [page, { ...popup, id: "other-extension" }, { ...popup, url: "https://untrusted.test" }])
    assert.equal(fixture.receive({ type: "version" }, sender, () => assert.fail("Unexpected response")), false);
  assert.equal(fixture.sensitiveCalls(), 0);
});

test("only a genuine first installation opens welcome", () => {
  const fixture = worker();
  fixture.installed?.({ reason: "update" });
  fixture.installed?.({ reason: "chrome_update" });
  assert.deepEqual(fixture.opened, []);
  fixture.installed?.({ reason: "install" });
  assert.deepEqual(fixture.opened, ["https://applyoverflow.com/extension/setup"]);
  assert.equal(fixture.sensitiveCalls(), 0);
});
