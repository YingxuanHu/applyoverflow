import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { installIndicator } from "../extensions/chrome/indicator.mjs";
import {
  SITE_ORIGINS,
  applicationContext,
} from "../extensions/chrome/sites.mjs";
const release = JSON.parse(
  await readFile("extensions/chrome/release.json", "utf8"),
);

const local = process.argv.find((arg) => arg.startsWith("--local="))?.slice(8);
const origin = local ? new URL(local).origin : "https://applyoverflow.com";
if (local && (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || local !== origin))
  throw new Error(
    "Local preview requires an exact http://127.0.0.1:PORT origin.",
  );
const destination = resolve(
  `output/extension/${local ? "local" : "production"}`,
);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of [
  "background.mjs",
  "sites.mjs",
  "popup.html",
  "popup.css",
  "popup.mjs",
])
  await cp(`extensions/chrome/${file}`, `${destination}/${file}`);
await cp("public/brand/applyoverflow-favicon.png", `${destination}/icon.png`);
await writeFile(
  `${destination}/config.mjs`,
  `export const APP_ORIGIN = ${JSON.stringify(origin)};\n`,
);
await writeFile(
  `${destination}/adapter-runtime.js`,
  `globalThis.__applyOverflowInspect ??= (${createInspector.toString()})(${applicationContext.toString()});\n`,
);
await writeFile(
  `${destination}/indicator.js`,
  `(${installIndicator.toString()})();\n`,
);
await writeFile(
  `${destination}/manifest.json`,
  JSON.stringify(
    {
      manifest_version: 3,
      name: `ApplyOverflow Assistant${local ? " (local preview)" : " (preview)"}`,
      version: release.version,
      ...(!local ? { key: release.publicKey } : {}),
      minimum_chrome_version: "120",
      description:
        "Fill confirmed contact details and review application questions. Never submits applications.",
      permissions: ["activeTab", "scripting", "storage", "identity"],
      host_permissions: [`${origin}/*`],
      optional_host_permissions: SITE_ORIGINS,
      background: { service_worker: "background.mjs", type: "module" },
      action: { default_popup: "popup.html", default_icon: "icon.png" },
      icons: { 128: "icon.png" },
    },
    null,
    2,
  ),
);
const files = {};
for (const file of (await readdir(destination)).sort())
  files[file] = [
    new Uint8Array(await readFile(`${destination}/${file}`)),
    { mtime: new Date("2026-01-01T00:00:00Z") },
  ];
const archive = zipSync(files, { level: 9 });
const archivePath = `${destination}.zip`;
await writeFile(archivePath, archive);
if (process.argv.includes("--publish")) {
  if (local) throw new Error("Local builds cannot be published.");
  await mkdir("public/downloads", { recursive: true });
  await writeFile("public/downloads/applyoverflow-assistant.zip", archive);
}
console.log(
  `Unpacked preview: ${destination}\nZIP: ${archivePath} (${archive.length} bytes)\n${local ? "Enable its Chrome extension ID" : `Preview ID: ${release.previewId}; enable this ID`} in APPLICATION_EXTENSION_IDS before connecting.`,
);
