import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { SITE_ORIGINS } from "../extensions/chrome/sites.mjs";

for (const [args, name] of [
  [[], "production"],
  [["--store"], "store"],
  [["--store-test"], "store-test"],
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
    name.startsWith("store")
      ? "ApplyOverflow Assistant"
      : "ApplyOverflow Assistant (preview)",
  );
  if (name === "store-test") {
    const id = createHash("sha256")
      .update(Buffer.from(manifest.key, "base64"))
      .digest("hex")
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + parseInt(char, 16)));
    assert.equal(id, "mhkkioknljkgnhgnhcamilkgbadjnmil");
    const upload = unzipSync(await readFile("output/extension/store.zip"));
    const withoutKey = { ...manifest };
    delete withoutKey.key;
    assert.deepEqual(withoutKey, JSON.parse(strFromU8(upload["manifest.json"])));
    for (const file of Object.keys(files).filter((file) => file !== "manifest.json"))
      assert.deepEqual(files[file], upload[file], `${file} differs from the uploaded Store package`);
  }
  assert.match(
    strFromU8(files["config.mjs"]),
    /^export const APP_ORIGIN = "https:\/\/applyoverflow\.com";\nexport const BUILD_ID = "[a-f0-9]{20}";\n$/,
  );
  console.log(
    `PASS: ${name} package, ${zip.length} bytes, fixed origin and minimal permissions`,
  );
}
for (const flags of [
  ["--store", "--publish"],
  ["--store", "--local=http://127.0.0.1:3004"],
  ["--store-test", "--publish"],
  ["--store-test", "--local=http://127.0.0.1:3004"],
  ["--store", "--store-test"],
])
  assert.notEqual(
    spawnSync(process.execPath, [
      "scripts/build-application-extension.mjs",
      ...flags,
    ]).status,
    0,
  );
