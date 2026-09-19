import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { SITE_ORIGINS } from "../extensions/chrome/sites.mjs";

for (const [args, name] of [
  [[], "production"],
  [["--store"], "store"],
]) {
  execFileSync(process.execPath, [
    "scripts/build-application-extension.mjs",
    ...args,
  ]);
  const zip = await readFile(`output/extension/${name}.zip`);
  assert.ok(
    zip.length < 150 * 1024,
    "Keep the package small; no dependencies or extra resume storage",
  );
  const files = unzipSync(zip);
  assert.deepEqual(
    Object.keys(files).sort(),
    [
      "adapter-runtime.js",
      "background.mjs",
      "config.mjs",
      "icon.png",
      "indicator.js",
      "manifest.json",
      "popup.css",
      "popup.html",
      "popup.mjs",
      "sites.mjs",
    ].sort(),
  );
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://applyoverflow.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions, SITE_ORIGINS);
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "scripting",
    "storage",
    "identity",
  ]);
  assert.ok(!manifest.externally_connectable);
  assert.equal("key" in manifest, name !== "store");
  assert.equal(
    manifest.name,
    name === "store"
      ? "ApplyOverflow Assistant"
      : "ApplyOverflow Assistant (preview)",
  );
  assert.equal(
    strFromU8(files["config.mjs"]),
    'export const APP_ORIGIN = "https://applyoverflow.com";\n',
  );
  console.log(
    `PASS: ${name} package, ${zip.length} bytes, fixed origin and minimal permissions`,
  );
}
for (const flags of [
  ["--store", "--publish"],
  ["--store", "--local=http://127.0.0.1:3004"],
])
  assert.notEqual(
    spawnSync(process.execPath, [
      "scripts/build-application-extension.mjs",
      ...flags,
    ]).status,
    0,
  );
