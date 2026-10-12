import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SITE_ORIGINS, APPLICATION_ORIGINS, detectionOrigins } from "../extensions/chrome/sites.mjs";

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
test("common-site grants remain narrow; broader detection requires an explicit HTTPS grant", () => {
  assert.equal(SITE_ORIGINS.length, 11);
  assert.ok(SITE_ORIGINS.includes("https://apply.workable.com/*"));
  for (const origin of SITE_ORIGINS) {
    assert.match(origin, /^https:\/\/(?:\*\.)?[a-z.-]+\/\*$/);
    if (origin.includes("*.")) assert.ok(["https://*.myworkdayjobs.com/*", "https://*.icims.com/*", "https://*.careers.hibob.com/*"].includes(origin));
    assert.equal(origin.includes("localhost"), false);
  }
  assert.deepEqual(APPLICATION_ORIGINS, ["https://*/*"]);
  assert.deepEqual(detectionOrigins(["https://applyoverflow.com/*"]), []);
  assert.deepEqual(detectionOrigins(["https://company.example/*"]), ["https://company.example/*"]);
  assert.deepEqual(detectionOrigins(["https://*/*", ...SITE_ORIGINS]), APPLICATION_ORIGINS);
  assert.deepEqual(detectionOrigins(["http://localhost/*", "file:///*"]), []);
});
