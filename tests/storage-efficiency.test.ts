import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  for (const runtimePath of ["data/uploads", "data/automation-screenshots"]) {
    for (const script of ["rebuild.sh", "rebuild-staging.sh"]) {
      assert.ok(read(`deploy/single-vps/${script}`).includes(`--exclude='${runtimePath}'`));
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
      if [[ "$#" == 3 && "$3" == / ]]; then
        printf '%s\\n' "$TEST_ROOT_DEVICE"
      elif [[ "$TEST_DEVICE_MISMATCH" == 1 && "$4" == / ]]; then
        printf '2\\n'
      else printf '1\\n'; fi
    }
    resolve_backup_directory
    printf '%s\\n' "$BACKUP_DIR" "$DB_BACKUP_HOST_DIR"
  `], {
    cwd: root, encoding: "utf8", timeout: 3000,
    env: { ...process.env, TEST_BACKUP_DIR: "", TEST_VOLUME: "", TEST_MOUNTED: "1",
      TEST_RESOLVED: "", TEST_STAT_FAIL: "0", TEST_DEVICE_MISMATCH: "0", TEST_ROOT_DEVICE: "0", ...env },
  });
}

test("relative backup paths resolve from the compose directory, not the repository", () => {
  const result = resolveBackup({ TEST_BACKUP_DIR: "backups", TEST_VOLUME: "/app/deploy" });
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
  assert.notEqual(resolveBackup({ ...base, TEST_ROOT_DEVICE: "1" }).status, 0);
  assert.notEqual(resolveBackup({ TEST_BACKUP_DIR: "/vol-other/backups", TEST_VOLUME: "/vol" }).status, 0);
});

test("backup paths are not evaluated as shell programs", () => {
  const dir = "/vol/backups with spaces $(echo UNSAFE)";
  const result = resolveBackup({ TEST_BACKUP_DIR: dir, TEST_VOLUME: "/vol" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${dir}\n${dir}\n`);
});

test("backup staging never silently falls back to the root filesystem", () => {
  const result = resolveBackup({ TEST_BACKUP_DIR: "backups" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated mounted filesystem/);
});

test("backup and restore share path validation and restore avoids Compose dependency recreation", () => {
  for (const file of ["backup-to-storage.sh", "restore-drill.sh"]) {
    const source = read(`deploy/single-vps/${file}`);
    assert.match(source, /source "\$SCRIPT_DIR\/backup-path\.sh"/);
    assert.doesNotMatch(source, /source "\$ENV_FILE"/);
    assert.match(source, /resolve_backup_directory/);
  }
  const backup = read("deploy/single-vps/backup-to-storage.sh");
  assert.ok(backup.indexOf("flock -n 9") < backup.indexOf('exec -T postgres pg_dump'));
  const restore = read("deploy/single-vps/restore-from-storage.sh");
  assert.match(restore, /exec bash "\$SCRIPT_DIR\/restore-drill.sh" "\$1"/);
  assert.doesNotMatch(restore, /pg_restore|prisma migrate deploy|COMPOSE/);
  const drill = read("deploy/single-vps/restore-drill.sh");
  assert.match(drill, /CONFIRM_ISOLATED_RESTORE_DRILL/);
  assert.match(drill, /--network none --memory 2g --memory-swap 2g/);
  assert.match(drill, /pg_restore --exit-on-error --single-transaction/);
  assert.doesNotMatch(drill.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n"), /prisma migrate deploy|exec -T postgres|--clean/);
  assert.match(read("deploy/single-vps/backup-path.sh"), /run -T --rm --no-deps/);
});

function deployRemote() {
  const source = read("deploy/single-vps/rebuild.sh");
  return source.split("remote_script=$(cat <<'REMOTE_SCRIPT'\n")[1].split("\nREMOTE_SCRIPT\n")[0]
    .replace("VOLUME=/mnt/HC_Volume_105915443", 'VOLUME="$TEST_DEPLOY_VOLUME"');
}

function runDeployment(input: string, env: Partial<NodeJS.ProcessEnv>) {
  const volume = mkdtempSync(path.join(tmpdir(), "ao-deploy-volume-"));
  mkdirSync(path.join(volume, "autoapplication/storage-cutover"), { recursive: true });
  writeFileSync(path.join(volume, "Caddyfile"), 'dev.example.test {\n  respond "Private" 403\n}\n');
  try {
    return spawnSync("bash", ["-s"], {
      cwd: root, encoding: "utf8", timeout: 5000,
      input: `
mountpoint() { [[ "$MOCK_MOUNT" != missing ]]; }
stat() { if [[ "$MOCK_MOUNT" == wrong && "$*" == *"/var/lib/"* ]]; then printf '1\\n'; else printf '2\\n'; fi; }
flock() { [[ "$MOCK_MOUNT" != locked ]] || return 1; lock_acquired=1; }
df() {
  case "$*" in
    *--output=avail*) printf '%s\\n' 'Available' "$MOCK_ROOT_FREE";;
    *--output=size,avail*) printf 'Size Avail\\n400000000000 %s\\n' "\${MOCK_VOLUME_FREE:-200000000000}";;
  esac
}
mock_docker() {
  case "$*" in
    *"exec -T -e EXPECTED_REVISION="*)
      cat >/dev/null
      [[ "\${MOCK_HEALTH_FAILURE:-0}" != 1 ]] || return 44
      printf 'DOCKER %s\\n' "$*";;
    *"exec -T caddy caddy "*)
      [[ "$*" == *" --config /dev/stdin --adapter caddyfile" ]] || return 90
      cmp -s - "$TEST_DEPLOY_VOLUME/Caddyfile" || return 91
      printf 'DOCKER %s\\nCADDY_STDIN_MATCH\\n' "$*"
      if [[ "\${MOCK_CADDY_FAILURE:-}" == validate && "$*" == *" caddy validate "* ]]; then return 42; fi
      if [[ "\${MOCK_CADDY_FAILURE:-}" == reload && "$*" == *" caddy reload "* ]]; then return 43; fi;;
    *"config --images"*)
      [[ "$*" == *"--profile ops"* ]] || return 1
      printf 'single-vps-app\\nsingle-vps-worker-maintenance\\nsingle-vps-worker-source-workers\\n'
      [[ "\${MOCK_OPS_IMAGE:-present}" == missing ]] || printf 'single-vps-backup-runner\\n';;
    *"ps --all --quiet"*) printf 'deployed-container\\n';;
    "inspect --format {{.Image}} deployed-container") printf 'sha256:deployed-image\\n';;
    *"image inspect"*"Architecture"*) printf '%s\\n' "\${TEST_PLATFORM:-linux/amd64}";;
    *"image inspect"*"revision"*) printf '%s\\n' "\${TEST_REVISION:-test-release}";;
    *"image inspect"*".Id"*"single-vps-backup-runner:latest") printf 'sha256:previous-backup\\n';;
    *"image inspect"*".Id"*) printf 'sha256:unverified-candidate\\n';;
    *) printf 'DOCKER %s\\n' "$*";;
  esac
}
docker() { mock_docker "$@"; }
${input}`,
      env: { ...process.env, MOCK_MOUNT: "healthy", MOCK_ROOT_FREE: "10000000000", ...env,
        TEST_DEPLOY_VOLUME: volume, COMPOSE_FILE: path.join(volume, "test.yml") },
    });
  } finally { rmSync(volume, { recursive: true, force: true }); }
}

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

test("app-only releases build current migrations and never recreate database dependencies", () => {
  const result = runDeployment(deployRemote(), {
      REMOTE_APP_DIR: root, BUILD_SHA: "test-release", ENV_FILE: "test.env",
      COMPOSE_FILE: "test.yml", BUILD_SERVICES: "app", SERVICES: "app", LEGACY_SERVICES: "",
      DOCKER_BUILD_CACHE_MAX_AGE: "24h", PRUNE_UNUSED_IMAGES: "0", REMOTE_BUILDER: "",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.indexOf("build worker-maintenance") < result.stdout.indexOf("prisma migrate deploy"));
  assert.match(result.stdout, /run -T --rm --no-deps worker-maintenance node --import tsx --test tests\/ssrf-guard.test.ts/);
  assert.ok(result.stdout.indexOf("--test tests/ssrf-guard.test.ts") < result.stdout.indexOf("prisma migrate deploy"));
  assert.match(result.stdout, /run -T --rm --no-deps worker-maintenance npx prisma migrate deploy/);
  assert.match(result.stdout, /up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 app/);
  assert.doesNotMatch(result.stdout, /(?:stop|rm -f|up -d).*postgres/);
  assert.match(result.stdout, /image tag single-vps-worker-maintenance:latest single-vps-backup-runner:latest/);
  assert.doesNotMatch(result.stdout, /(?:build|up -d|run -T).*backup-runner/);
  assert.ok(result.stdout.indexOf("caddy validate") < result.stdout.indexOf("image tag"));
  assert.ok(result.stdout.indexOf("caddy validate") < result.stdout.indexOf("build app"));
  assert.ok(result.stdout.indexOf("EXPECTED_REVISION=") < result.stdout.indexOf("caddy reload"));
  assert.equal(result.stdout.match(/CADDY_STDIN_MATCH/g)?.length, 2);
  assert.doesNotMatch(result.stdout, /(?:stop|rm -f|up -d|restart|run -T).*caddy/);
});

test("failed candidate transport verification blocks migrations and service restarts", () => {
  const result = runDeployment(`docker() { case "$*" in *ssrf-guard.test.ts*) return 1;; esac; mock_docker "$@"; }\n${deployRemote()}`, {
      REMOTE_APP_DIR: root, BUILD_SHA: "test-release", ENV_FILE: "test.env",
      COMPOSE_FILE: "test.yml", BUILD_SERVICES: "app", SERVICES: "app", LEGACY_SERVICES: "",
      DOCKER_BUILD_CACHE_MAX_AGE: "24h", PRUNE_UNUSED_IMAGES: "0", REMOTE_BUILDER: "",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /prisma migrate deploy|up -d|caddy reload/);
  assert.doesNotMatch(result.stdout, /image tag .*single-vps-backup-runner:latest/);
});

test("remote health verification cannot consume finalization or promote after a failure", () => {
  const env = {
    REMOTE_APP_DIR: root, BUILD_SHA: "test-release", PREBUILT_SHA: "test-release", ENV_FILE: "test.env",
    BUILD_SERVICES: "app", SERVICES: "app", LEGACY_SERVICES: "", PRUNE_UNUSED_IMAGES: "0",
  };
  const success = runDeployment(deployRemote(), env);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /caddy reload/);
  assert.match(success.stdout, /image tag .*single-vps-backup-runner:latest/);
  assert.match(success.stdout, /image rm applyoverflow-release:test-release-web/);
  assert.match(success.stdout, /Disk after cleanup:/);

  const failure = runDeployment(deployRemote(), { ...env, MOCK_HEALTH_FAILURE: "1" });
  assert.equal(failure.status, 44, failure.stderr);
  assert.doesNotMatch(failure.stdout, /caddy reload|image tag .*single-vps-backup-runner:latest|image rm/);
});

test("deployment can direct builds and pruning to an attached-volume builder", () => {
  const result = runDeployment(deployRemote(), {
      REMOTE_APP_DIR: root, BUILD_SHA: "test-release", ENV_FILE: "test.env",
      COMPOSE_FILE: "test.yml", BUILD_SERVICES: "app", SERVICES: "app", LEGACY_SERVICES: "",
      DOCKER_BUILD_CACHE_MAX_AGE: "0", PRUNE_UNUSED_IMAGES: "0", REMOTE_BUILDER: "release-volume",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /build --builder release-volume app/);
  assert.match(result.stdout, /build --builder release-volume worker-maintenance/);
  assert.match(result.stdout, /buildx --builder release-volume prune -af/);
  assert.doesNotMatch(result.stdout, /DOCKER builder prune/);
});

test("prebuilt deployment verifies revision/platform, keeps smoke tests and migrations, and never builds on the VPS", () => {
  const run = (revision = "test-release", platform = "linux/amd64", services = "app") => runDeployment(deployRemote(), { REMOTE_APP_DIR: root, BUILD_SHA: "test-release", PREBUILT_SHA: "test-release", ENV_FILE: "test.env",
      COMPOSE_FILE: "test.yml", BUILD_SERVICES: services, SERVICES: services, LEGACY_SERVICES: "", TEST_REVISION: revision, TEST_PLATFORM: platform,
      DOCKER_BUILD_CACHE_MAX_AGE: "0", PRUNE_UNUSED_IMAGES: "0", REMOTE_BUILDER: "",
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /image tag applyoverflow-release:test-release-web single-vps-app:latest/);
  assert.match(result.stdout, /ssrf-guard.test.ts/);
  assert.match(result.stdout, /pdf-runtime-smoke.mjs/);
  assert.match(result.stdout, /prisma migrate deploy/);
  assert.match(result.stdout, /up -d --no-deps --no-build/);
  assert.match(result.stdout, /image tag applyoverflow-release:test-release-worker single-vps-backup-runner:latest/);
  assert.match(result.stdout, /image tag sha256:previous-backup applyoverflow-rollback:previous-backup-runner/);
  assert.ok(result.stdout.indexOf("EXPECTED_REVISION=") < result.stdout.indexOf("image tag applyoverflow-release:test-release-worker single-vps-backup-runner:latest"));
  assert.doesNotMatch(result.stdout, /DOCKER.*(?:build app|build worker|builder prune|buildx)/);
  const workerOnly = run("test-release", "linux/amd64", "worker-source-workers");
  assert.equal(workerOnly.status, 0, workerOnly.stderr);
  assert.match(workerOnly.stdout, /up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 worker-source-workers/);
  assert.doesNotMatch(workerOnly.stdout, /test-release-web|pdf-runtime-smoke|single-vps-app:latest/);
  for (const rejected of [run("wrong-revision"), run("test-release", "linux/arm64")]) {
    assert.equal(rejected.status, 1);
    assert.doesNotMatch(rejected.stdout, /image tag applyoverflow-release:|prisma migrate deploy|up -d/);
    assert.match(rejected.stdout, /image tag sha256:deployed-image applyoverflow-rollback:previous-worker/);
  }
});

test("deployment storage checks prevent missing mounts, wrong devices, active migration and low root reserve", () => {
  for (const failure of ["missing", "wrong", "locked", "full"]) {
    const result = runDeployment(deployRemote(), {
      REMOTE_APP_DIR: root, BUILD_SHA: "test-release", ENV_FILE: "test.env", COMPOSE_FILE: "test.yml",
      MOCK_MOUNT: failure, MOCK_ROOT_FREE: failure === "full" ? "1000" : "10000000000",
    });
    assert.notEqual(result.status, 0, failure);
    assert.doesNotMatch(result.stdout, /prisma migrate deploy|up -d|DOCKER.*build|DOCKER image tag/);
  }
});

test("release retries pin deployed containers, and optional pruning retains rollback tags", () => {
  const result = runDeployment(deployRemote(), {
    REMOTE_APP_DIR: root, BUILD_SHA: "test-release", PREBUILT_SHA: "test-release", ENV_FILE: "test.env",
    COMPOSE_FILE: "test.yml", BUILD_SERVICES: "app", SERVICES: "app", LEGACY_SERVICES: "",
    DOCKER_BUILD_CACHE_MAX_AGE: "0", PRUNE_UNUSED_IMAGES: "1", REMOTE_BUILDER: "",
  });
  assert.equal(result.status, 0, result.stderr);
  for (const variant of ["web", "worker"]) {
    assert.match(result.stdout, new RegExp(`image tag sha256:deployed-image applyoverflow-rollback:previous-${variant}`));
  }
  assert.doesNotMatch(result.stdout, /image tag sha256:unverified-candidate applyoverflow-rollback/);
  assert.match(result.stdout, /DOCKER image prune -f\n/);
  assert.doesNotMatch(result.stdout, /DOCKER image prune .*a/);
});

test("ops image mismatch or failed app health prevents backup-runner promotion", () => {
  for (const failure of ["ops-name", "health"]) {
    const result = runDeployment(`docker() {
      if [[ "$MOCK_FAILURE" == health && "$*" == *"EXPECTED_REVISION="* ]]; then return 1; fi
      mock_docker "$@"
    }\n${deployRemote()}`, {
      REMOTE_APP_DIR: root, BUILD_SHA: "test-release", PREBUILT_SHA: "test-release", ENV_FILE: "test.env",
      COMPOSE_FILE: "test.yml", BUILD_SERVICES: "app", SERVICES: "app", LEGACY_SERVICES: "",
      DOCKER_BUILD_CACHE_MAX_AGE: "0", PRUNE_UNUSED_IMAGES: "0", REMOTE_BUILDER: "",
      MOCK_FAILURE: failure, MOCK_OPS_IMAGE: failure === "ops-name" ? "missing" : "present",
    });
    assert.notEqual(result.status, 0, failure);
    assert.doesNotMatch(result.stdout, /image tag .*single-vps-backup-runner:latest/);
    assert.doesNotMatch(result.stdout, /caddy reload/);
    if (failure === "ops-name") assert.doesNotMatch(result.stdout, /prisma migrate deploy|up -d/);
  }
});

test("Caddy validation and reload fail closed without recreating Caddy or the database", () => {
  for (const prebuilt of ["", "test-release"]) {
    for (const failure of ["validate", "reload", "restart", "migration"] as const) {
      const result = runDeployment(`docker() {
        if [[ "$MOCK_FAILURE" == restart && "$*" == *" up -d "* ]]; then return 44; fi
        if [[ "$MOCK_FAILURE" == migration && "$*" == *"prisma migrate deploy"* ]]; then return 45; fi
        mock_docker "$@"
      }\n${deployRemote()}`, {
        REMOTE_APP_DIR: root, BUILD_SHA: "test-release", PREBUILT_SHA: prebuilt, ENV_FILE: "test.env",
        BUILD_SERVICES: "app", SERVICES: "app", LEGACY_SERVICES: "", REMOTE_BUILDER: "",
        DOCKER_BUILD_CACHE_MAX_AGE: "0", PRUNE_UNUSED_IMAGES: "1",
        MOCK_FAILURE: failure, MOCK_CADDY_FAILURE: failure,
      });
      assert.equal(result.status, { validate: 42, reload: 43, restart: 44, migration: 45 }[failure], `${prebuilt}:${failure}: ${result.stderr}`);
      assert.match(result.stdout, /exec -T caddy caddy validate --config \/dev\/stdin --adapter caddyfile/);
      assert.doesNotMatch(result.stdout, /(?:stop|rm -f|up -d|restart|run -T).*\b(?:caddy|postgres)\b/);
      assert.doesNotMatch(result.stdout, /image tag .*single-vps-backup-runner:latest|image rm|prune/);
      if (failure === "validate") {
        assert.doesNotMatch(result.stdout, /network create|image tag|DOCKER.*build|prisma migrate deploy|up -d/);
      }
      if (failure === "reload") {
        assert.ok(result.stdout.indexOf("EXPECTED_REVISION=") < result.stdout.indexOf("caddy reload"));
        assert.equal(result.stdout.match(/CADDY_STDIN_MATCH/g)?.length, 2);
      } else {
        assert.doesNotMatch(result.stdout, /caddy reload/);
      }
    }
  }
});

test("image transfer holds the migration lock and rechecks storage before loading", () => {
  const source = read("deploy/single-vps/build-release-local.sh");
  const transfer = source.split("transfer_script=$(cat <<'TRANSFER_SCRIPT'\n")[1].split("\nTRANSFER_SCRIPT\n")[0]
    .replace("volume=/mnt/HC_Volume_105915443", 'volume="$TEST_DEPLOY_VOLUME"');
  for (const failure of ["healthy", "missing", "wrong", "locked", "full"]) {
    const result = runDeployment(`
gzip() { printf 'synthetic image stream'; }
docker() { [[ "\${lock_acquired:-0}" == 1 ]] || return 1; mock_docker "$@"; cat >/dev/null; }
${transfer}`, {
      MOCK_MOUNT: failure, MOCK_VOLUME_FREE: failure === "full" ? "1000" : "200000000000",
    });
    if (failure === "healthy") {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /DOCKER image load/);
    } else {
      assert.notEqual(result.status, 0, failure);
      assert.doesNotMatch(result.stdout, /DOCKER image load/);
    }
  }
  assert.match(read("deploy/single-vps/rebuild.sh"), /--rsync-path='flock -n \/mnt\/HC_Volume_105915443\/autoapplication\/storage-cutover\/migration.lock rsync'/);
});
