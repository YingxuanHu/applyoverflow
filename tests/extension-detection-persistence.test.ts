import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { applicationContext, detectionOrigins, sameApplication } from "../extensions/chrome/sites.mjs";
import { createWorkspaceBridge, allowedWorkspaceSender, resolveAppPageSender } from "../extensions/chrome/workspace-bridge.mjs";
import { createSetupBridge, allowedSetupSender } from "../extensions/chrome/setup-bridge.mjs";

type Script = { id: string; matches: string[]; allFrames: boolean; persistAcrossSessions?: boolean };

async function detectionFixture(origins: string[], existing?: Script) {
  let scripts = existing ? [existing] : [];
  const events: Record<string, () => void> = {};
  let grants = origins;
  const event = (name: string) => ({ addListener: (callback: () => void) => { events[name] = callback; } });
  const forbidden = () => assert.fail("Detection must not request permissions, read a profile, or fill anything");
  const source = readFileSync(new URL("../extensions/chrome/background.mjs", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "");
  const sandbox = {
    APP_ORIGIN: "https://applyoverflow.com", BUILD_ID: "test", URL,
    applicationContext, detectionOrigins, sameApplication,
    createWorkspaceBridge, allowedWorkspaceSender, resolveAppPageSender, createSetupBridge, allowedSetupSender,
    fetch: forbidden,
    chrome: {
      runtime: { id: "test", onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message") },
      permissions: { getAll: async () => ({ origins: grants }), request: forbidden, onAdded: event("added"), onRemoved: event("removed") },
      tabs: { query: async () => [], onRemoved: event("tab-removed") },
      scripting: {
        getRegisteredContentScripts: async () => scripts,
        registerContentScripts: async (values: Script[]) => { scripts = structuredClone(values); },
        updateContentScripts: async (values: Script[]) => { scripts = scripts.map(script => ({ ...script, ...values.find(value => value.id === script.id) })); },
        unregisterContentScripts: async () => { scripts = []; },
      },
    },
  };
  runInNewContext(source, sandbox);
  const settled = () => runInNewContext("registration", sandbox) as Promise<void>;
  await settled();
  return {
    scripts: () => scripts,
    event: async (name: string) => { events[name](); await settled(); },
    grant: (value: string[]) => { grants = value; },
    loseRegistration: () => { scripts = []; },
  };
}

test("all-site detection persists and restores after a worker restart without asking again", async () => {
  const fixture = await detectionFixture(["https://*/*"]);
  assert.equal(fixture.scripts()[0].persistAcrossSessions, true);
  assert.equal(fixture.scripts()[0].allFrames, true);
  assert.deepEqual(Array.from(fixture.scripts()[0].matches), ["https://*/*"]);
  fixture.loseRegistration();
  await fixture.event("startup");
  assert.equal(fixture.scripts()[0].persistAcrossSessions, true);
});

test("existing session-only registrations are repaired during update/worker startup", async () => {
  const fixture = await detectionFixture(["https://*/*"], {
    id: "application-detection", matches: ["https://*/*"], allFrames: true, persistAcrossSessions: false,
  });
  assert.equal(fixture.scripts()[0].persistAcrossSessions, true);
});

test("limited consent is never silently widened and revoked grants stay revoked", async () => {
  const fixture = await detectionFixture(["https://applyoverflow.com/*", "https://employer.example/*"]);
  assert.deepEqual(Array.from(fixture.scripts()[0].matches), ["https://employer.example/*"]);
  fixture.grant(["https://*/*"]);
  await fixture.event("added");
  assert.deepEqual(Array.from(fixture.scripts()[0].matches), ["https://*/*"]);
  fixture.grant(["https://applyoverflow.com/*"]);
  await fixture.event("removed");
  assert.equal(fixture.scripts().length, 0);
  await fixture.event("startup");
  assert.equal(fixture.scripts().length, 0);
});
