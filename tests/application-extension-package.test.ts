import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SITE_ORIGINS } from "../extensions/chrome/sites.mjs";

test("downloadable preview has a stable public Chrome identity", () => {
  const release = JSON.parse(
    readFileSync(
      new URL("../extensions/chrome/release.json", import.meta.url),
      "utf8",
    ),
  );
  const id = createHash("sha256")
    .update(Buffer.from(release.publicKey, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  assert.equal(id, release.previewId);
  assert.match(release.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(release).sort(), [
    "previewId",
    "publicKey",
    "version",
  ]);
});
test("automatic detection uses explicit ATS hosts, never arbitrary browsing access", () => {
  assert.equal(SITE_ORIGINS.length, 7);
  for (const origin of SITE_ORIGINS) {
    assert.match(origin, /^https:\/\/[a-z.-]+\/\*$/);
    assert.equal(origin.includes("*."), false);
    assert.equal(origin.includes("localhost"), false);
  }
});
