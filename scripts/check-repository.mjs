import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function prohibitedRepositoryPath(path) {
  const generated = /^(?:node_modules|\.next|out|build|coverage|output|logs|\.runtime|\.vercel|\.playwright-cli|playwright-report|test-results|\.deploy-backups|src\/generated\/prisma|data\/(?:uploads|automation-screenshots)|deploy\/single-vps\/backups)\//;
  const basename = path.split("/").at(-1);
  const privateEnvironment = /^\.env(?:\.|$)/.test(basename) && !basename.endsWith(".example");
  return generated.test(path) || privateEnvironment ||
    /(?:\.dump|\.bundle|\.tsbuildinfo)$/.test(path) ||
    basename === ".DS_Store" || /^\d+$/.test(path);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root, encoding: "utf8",
  }).split("\0").filter(Boolean);
  const invalid = files.filter(prohibitedRepositoryPath);
  if (invalid.length) {
    throw new Error(`Generated or private files must not be committed:\n${invalid.join("\n")}`);
  }
  const config = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
  if (config.git?.deploymentEnabled !== false) {
    throw new Error("Automatic deployments to the retired hosting provider must remain disabled.");
  }
  for (const path of [".nvmrc", ".env.example", "deploy/single-vps/.env.production.example", "deploy/single-vps/.env.staging.example"]) {
    if (!files.includes(path)) throw new Error(`Missing repository configuration: ${path}`);
  }
  console.log(`Repository hygiene passed (${files.length} files checked).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
