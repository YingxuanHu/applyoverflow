import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { load } = require("js-yaml") as { load: (text: string) => {
  services: Record<string, { logging: unknown; environment?: Record<string, string> }>;
} };
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("every production and staging container has bounded, compressed logs", () => {
  for (const file of ["docker-compose.yml", "docker-compose.staging.yml"]) {
    const { services } = load(read(`deploy/single-vps/${file}`));
    for (const [name, service] of Object.entries(services)) {
      assert.deepEqual(service.logging, {
        driver: "local", options: { "max-size": "20m", "max-file": "5", compress: "true" },
      }, name);
      if (name.startsWith("worker")) {
        assert.equal(service.environment?.APPLYOVERFLOW_CONTAINER_LOGS, "1", name);
      }
    }
  }
});

test("worker images do not copy dependencies twice or ship browser audit artifacts", () => {
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /FROM builder AS worker-files/);
  assert.match(dockerfile, /RUN rm -rf \/app\/node_modules \/app\/\.next\/standalone \/app\/\.next\/cache/);
  const runner = dockerfile.split("FROM base AS runner")[1];
  assert.match(runner, /COPY --from=builder \/app\/node_modules/);
  assert.match(runner, /COPY --from=worker-files \/app \.\//);
  assert.doesNotMatch(runner, /COPY --from=builder \/app \.\//);
  assert.match(runner, /playwright install --with-deps chromium/);
  for (const artifact of ["output", ".playwright-cli"]) {
    assert.ok(read(".dockerignore").split("\n").includes(artifact));
    for (const script of ["rebuild.sh", "rebuild-staging.sh"]) {
      assert.ok(read(`deploy/single-vps/${script}`).includes(`--exclude='${artifact}'`));
    }
  }
});

function workerApps(containerLogs: boolean) {
  const result = spawnSync(process.execPath, ["-e", `
    const apps = require('./ecosystem.config.cjs').apps;
    console.log(JSON.stringify(apps.map(({name, output, error, log, disable_logs}) => ({name, output, error, log, disable_logs}))));
  `], {
    cwd: root,
    env: { ...process.env, APPLYOVERFLOW_WORKER_GROUPS: "all", APPLYOVERFLOW_CONTAINER_LOGS: containerLogs ? "1" : "0" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Array<{ name: string; output?: string; error?: string; log?: string; disable_logs?: boolean }>;
}

test("container workers avoid disk duplicates without disabling the PM2 log event bus", () => {
  const apps = workerApps(true);
  assert.ok(apps.length > 5);
  for (const app of apps) {
    assert.equal(app.output, "/dev/null", app.name);
    assert.equal(app.error, "/dev/null", app.name);
    assert.equal(app.log, "/dev/null", app.name);
    assert.notEqual(app.disable_logs, true, app.name);
  }
  assert.ok(workerApps(false).some((app) => app.output?.startsWith("./logs/")));
});

test("PM2 runtime still emits stdout and stderr with file logs disabled", { timeout: 20000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "applyoverflow-log-test-"));
  const fixture = path.join(dir, "fixture.cjs");
  const config = path.join(dir, "ecosystem.config.cjs");
  const home = path.join(dir, "pm2");
  await writeFile(fixture, 'setInterval(() => { console.log("STORAGE_STDOUT_MARKER"); console.error("STORAGE_STDERR_MARKER"); }, 200);');
  await writeFile(config, `module.exports = ${JSON.stringify({ apps: [{
    name: "storage-log-test", script: fixture, autorestart: false,
    output: "/dev/null", error: "/dev/null", log: "/dev/null",
  }] })};`);
  const child = spawn(process.execPath, [path.join(root, "node_modules/pm2/bin/pm2-runtime"), config], {
    cwd: dir,
    env: { ...process.env, PM2_HOME: home, PM2_RUNTIME_DEBUG: "", PM2_PUBLIC_KEY: "", PM2_SECRET_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const deadline = setTimeout(() => reject(new Error(`PM2 did not stream both log markers: ${output.slice(-2000)}`)), 10000);
      const receive = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("STORAGE_STDOUT_MARKER") && output.includes("STORAGE_STDERR_MARKER")) {
          clearTimeout(deadline);
          resolve();
        }
      };
      child.once("error", (error) => { clearTimeout(deadline); reject(error); });
      child.stdout.on("data", receive);
      child.stderr.on("data", receive);
    });
    const files = await readdir(path.join(home, "logs"));
    assert.deepEqual(files, []);
  } finally {
    child.kill("SIGTERM");
    await closed;
    await rm(dir, { recursive: true, force: true });
  }
});

function resolveBackup(env: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", `
    set -euo pipefail
    source deploy/single-vps/backup-path.sh
    SCRIPT_DIR=/app/deploy/single-vps
    compose_env_value() {
      case "$1" in
        DB_BACKUP_HOST_DIR) printf '%s' "$TEST_BACKUP_DIR" ;;
        DB_BACKUP_VOLUME_MOUNT) printf '%s' "$TEST_VOLUME" ;;
      esac
    }
    # Mock Linux mount inspection, never create directories or access a DB.
    realpath() {
      if [[ -n "$TEST_RESOLVED" && "$3" == "$TEST_BACKUP_DIR" ]]; then
        printf '%s\\n' "$TEST_RESOLVED"
      else printf '%s\\n' "$3"; fi
    }
    mountpoint() { [[ "$TEST_MOUNTED" == 1 ]]; }
    stat() {
      [[ "$TEST_STAT_FAIL" != 1 ]] || return 1
      if [[ "$TEST_DEVICE_MISMATCH" == 1 && "$4" == / ]]; then
        printf '2\\n'
      else printf '1\\n'; fi
    }
    resolve_backup_directory
    printf '%s\\n' "$BACKUP_DIR" "$DB_BACKUP_HOST_DIR"
  `], {
    cwd: root, encoding: "utf8", timeout: 3000,
    env: { ...process.env, TEST_BACKUP_DIR: "", TEST_VOLUME: "", TEST_MOUNTED: "1",
      TEST_RESOLVED: "", TEST_STAT_FAIL: "0", TEST_DEVICE_MISMATCH: "0", ...env },
  });
}

test("relative backup paths resolve from the compose directory, not the repository", () => {
  const result = resolveBackup({ TEST_BACKUP_DIR: "backups" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "/app/deploy/single-vps/backups\n/app/deploy/single-vps/backups\n");
});

test("missing Hetzner mounts fail closed, including legacy configs", () => {
  const result = resolveBackup({ TEST_BACKUP_DIR: "/mnt/HC_Volume_123/backups", TEST_MOUNTED: "0" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not mounted/);
  assert.equal(result.stdout, "");
});

test("valid volume-backed paths match the backup container bind mount", () => {
  const result = resolveBackup({ TEST_BACKUP_DIR: "/mnt/HC_Volume_123/backups" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "/mnt/HC_Volume_123/backups\n/mnt/HC_Volume_123/backups\n");
});

test("custom mount, symlink escapes, different filesystems and failed inspection are guarded", () => {
  const base = { TEST_BACKUP_DIR: "/vol/backups", TEST_VOLUME: "/vol" };
  assert.equal(resolveBackup(base).status, 0);
  assert.notEqual(resolveBackup({ ...base, TEST_MOUNTED: "0" }).status, 0);
  assert.notEqual(resolveBackup({ ...base, TEST_RESOLVED: "/root/backups" }).status, 0);
  assert.notEqual(resolveBackup({ ...base, TEST_DEVICE_MISMATCH: "1" }).status, 0);
  assert.notEqual(resolveBackup({ ...base, TEST_STAT_FAIL: "1" }).status, 0);
  assert.notEqual(resolveBackup({ TEST_BACKUP_DIR: "/vol-other/backups", TEST_VOLUME: "/vol" }).status, 0);
});

test("backup paths are not evaluated as shell programs", () => {
  const dir = "/tmp/backups with spaces $(echo UNSAFE)";
  const result = resolveBackup({ TEST_BACKUP_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${dir}\n${dir}\n`);
});

test("backup and restore share path validation and restore avoids Compose dependency recreation", () => {
  for (const file of ["backup-to-storage.sh", "restore-from-storage.sh"]) {
    const source = read(`deploy/single-vps/${file}`);
    assert.match(source, /source "\$SCRIPT_DIR\/backup-path\.sh"/);
    assert.doesNotMatch(source, /source "\$ENV_FILE"/);
    assert.match(source, /resolve_backup_directory/);
  }
  const backup = read("deploy/single-vps/backup-to-storage.sh");
  assert.ok(backup.indexOf("flock -n 9") < backup.indexOf('exec -T postgres pg_dump'));
  const restore = read("deploy/single-vps/restore-from-storage.sh");
  assert.match(restore, /CONFIRM_RESTORE/);
  assert.doesNotMatch(restore, /run (?:-T )?--rm backup-runner/);
  assert.ok(restore.indexOf('rm -f -- "$RESTORE_FILE"') > restore.indexOf('prisma migrate deploy'));
});

test("storage inventory is read-only and bounded, with no job contents or full-table counts", () => {
  const sql = read("deploy/single-vps/storage-report.sql");
  assert.match(sql, /BEGIN READ ONLY/);
  assert.match(sql, /statement_timeout = '8s'/);
  assert.match(sql, /lock_timeout = '1s'/);
  const statements = sql.split("\n").filter((line) => !line.startsWith("\\") && !line.startsWith("--")).join("\n");
  assert.doesNotMatch(statements, /\b(?:DELETE|INSERT|UPDATE|TRUNCATE|ALTER|VACUUM|DROP)\b/i);
  assert.doesNotMatch(sql, /count\(\*\)|FROM "JobRaw"|FROM "JobCanonical"/i);
  assert.match(read("deploy/single-vps/report-storage.sh"), /timeout 30s/);
});
