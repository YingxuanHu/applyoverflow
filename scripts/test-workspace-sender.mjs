import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAppPageSender, allowedWorkspaceSender } from '../extensions/chrome/workspace-bridge.mjs';
import { allowedSetupSender } from '../extensions/chrome/setup-bridge.mjs';

test('SPA navigation validates the live route in the original, top-level trusted document', async () => {
  const origin = 'https://applyoverflow.com';
  const sender = { url: `${origin}/jobs/123`, origin, tab: { id: 7 }, frameId: 0, documentId: 'document-1' };
  let current = { frameId: 0, documentId: 'document-1', result: { href: `${origin}/applications/auto-apply?application=123`, origin, top: true } };
  const calls = [];
  globalThis.chrome = { scripting: { executeScript: async input => { calls.push(input.target); return [current]; } } };
  try {
    const resolved = await resolveAppPageSender(sender, origin);
    assert.equal(allowedWorkspaceSender(resolved, origin), true);
    assert.deepEqual(calls, [{ tabId: 7, documentIds: ['document-1'] }]);
    current.result.href = `${origin}/jobs`;
    assert.equal(allowedWorkspaceSender(await resolveAppPageSender({ ...sender, url: `${origin}/applications/auto-apply` }, origin), origin), false, 'navigating away revokes workspace route access');
    current.result.href = `${origin}/extension/setup`;
    assert.equal(allowedSetupSender(await resolveAppPageSender(sender, origin), origin), true);
    for (const patch of [{ origin: 'https://evil.example' }, { url: 'https://evil.example/' }, { frameId: 1 }, { documentId: '' }, { tab: {} }]) {
      const count = calls.length;
      assert.equal(await resolveAppPageSender({ ...sender, ...patch }, origin), null);
      assert.equal(calls.length, count, 'untrusted metadata cannot trigger script execution');
    }
    for (const patch of [{ documentId: 'replacement-document' }, { frameId: 1 }, { result: { ...current.result, top: false } }, { result: { ...current.result, origin: 'https://evil.example' } }]) {
      const before = current;
      current = { ...current, ...patch };
      assert.equal(await resolveAppPageSender(sender, origin), null);
      current = before;
    }
    chrome.scripting.executeScript = async () => { throw Error('Document unloaded'); };
    assert.equal(await resolveAppPageSender(sender, origin), null);
  } finally { delete globalThis.chrome; }
});
