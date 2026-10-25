import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWorkspaceConnection } from "../src/lib/applications/workspace-connection";
import { EXTENSION_STORE_ID } from "../src/lib/extension-setup";

test("workspace distinguishes browser support, installation and account connection", async () => {
  const ping = async () => ({ protocol: 1, version: "0.15.1" });
  assert.equal((await checkWorkspaceConnection(false, [], ping)).state, "unsupported");
  assert.equal((await checkWorkspaceConnection(true, [], ping)).state, "disconnected");
  assert.equal((await checkWorkspaceConnection(true, [EXTENSION_STORE_ID], ping)).state, "ready");
  assert.equal((await checkWorkspaceConnection(true, [], async () => ({ protocol: 0 }))).state, "outdated");
  const unavailable = await checkWorkspaceConnection(true, ["other-browser"], async () => { throw Error("No receiver"); });
  assert.equal(unavailable.state, "unavailable");
  assert.doesNotMatch(unavailable.message, /update required/i);
});

test("workspace probes the Store installation even after its account session expires", async () => {
  const checked: string[] = [];
  const result = await checkWorkspaceConnection(true, ["stale-preview"], async id => {
    checked.push(id);
    if (id !== EXTENSION_STORE_ID) throw Error("Disabled");
    return { protocol: 1, version: "0.15.1" };
  });
  assert.deepEqual(checked, ["stale-preview", EXTENSION_STORE_ID]);
  assert.equal(result.state, "disconnected");
  assert.equal(result.id, "", "capability ping alone cannot authorize profile export");
});
