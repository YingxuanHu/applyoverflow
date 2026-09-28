import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "release-headroom-"));
const dockerRoot = path.join(directory, "docker data");
const containerdRoot = path.join(directory, "containerd $(exit 99) ' data");
mkdirSync(dockerRoot);
mkdirSync(containerdRoot);
test.after(() => rmSync(directory, { recursive: true, force: true }));

// Execute the complete release script, but never call a daemon, SSH or rebuild.
const script = readFileSync(new URL("../deploy/single-vps/build-release-local.sh", import.meta.url), "utf8")
  .replace(/^SCRIPT_DIR=.*$/m, "SCRIPT_DIR=/mock-release")
  .replace(/^REPO_ROOT=.*$/m, "REPO_ROOT=/mock-repository");
const mocks = String.raw`
git() { case "$*" in *rev-parse*) printf '%s\n' test-sha;; *status*) :;; *) return 97;; esac; }
docker() {
  case "$*" in
    'buildx build '*) printf 'BUILD\n' >&2 ;;
    'image inspect '*)
      [[ "$TEST_INSPECT_FAIL" == 0 ]] || return 42
      case "$*" in *-web) printf '%s\n' "$TEST_WEB";; *-worker) printf '%s\n' "$TEST_WORKER";; *) return 97;; esac ;;
    'info '*)
      [[ "$TEST_INFO_FAIL" == 0 ]] || return 42
      case "$*" in
        *DockerRootDir*) printf '%s\n' "$TEST_DOCKER_ROOT" ;;
        *DriverStatus*) printf '%s\n' "$TEST_STORE" ;;
        *Driver*) printf '%s\n' "$TEST_DRIVER" ;;
        *) return 97 ;;
      esac ;;
    'image save '*) printf 'SAVE\n' >&2; printf 'mock-archive\n' ;;
    'image load') cat >/dev/null; printf 'LOAD\n' >&2 ;;
    *) printf 'Unexpected Docker call: %s\n' "$*" >&2; return 97 ;;
  esac
}
df() {
  [[ "$1" == -Pk && "$2" == -- && "$#" == 3 ]] || return 98
  [[ "$TEST_DF_FAIL" == 0 ]] || return 42
  case "$3" in
    /) available="$TEST_ROOT_AVAILABLE" ;;
    "$TEST_DOCKER_ROOT") available="$TEST_AVAILABLE" ;;
    "$SINGLE_VPS_CONTAINERD_ROOT") available="$TEST_CONTAINERD_AVAILABLE" ;;
    *) printf 'Unexpected df path: %s\n' "$3" >&2; return 98 ;;
  esac
  printf 'DF %s\n' "$3" >&2
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
  printf 'mockfs 99999999999 0 %s 0%% /mock-mount\n' "$available"
}
gzip() { cat; }
bash() {
  if [[ "$1" == /mock-release/rebuild.sh ]]; then printf 'REBUILD\n' >&2;
  else command bash "$@"; fi
}
ssh() { shift; command bash -c "$1"; }
export -f git docker df gzip bash ssh
`;
const gib = 1024 ** 3;
function run(env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", ["-s"], {
    input: mocks + script, encoding: "utf8", timeout: 5000,
    env: { ...process.env, SINGLE_VPS_HOST: "unused.invalid", SINGLE_VPS_CONTAINERD_ROOT: "",
      TEST_WEB: String(gib / 2), TEST_WORKER: String(gib), TEST_AVAILABLE: String(7 * gib / 1024),
      TEST_ROOT_AVAILABLE: String(4 * gib / 1024), TEST_CONTAINERD_AVAILABLE: String(7 * gib / 1024),
      TEST_DOCKER_ROOT: dockerRoot, TEST_DRIVER: "overlay2", TEST_STORE: "",
      TEST_INSPECT_FAIL: "0", TEST_INFO_FAIL: "0", TEST_DF_FAIL: "0", ...env },
  });
}

test("legacy Docker passes only at the full image estimate plus reserve, before save/load", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /required=7516192768 bytes/);
  assert.ok(result.stderr.includes(`DF ${dockerRoot}\n`));
  assert.ok(result.stderr.indexOf("required=7516192768") < result.stderr.indexOf("SAVE\n"));
  assert.match(result.stderr, /LOAD\n/);
  assert.match(result.stderr, /REBUILD\n/);
  assert.equal(run({ TEST_AVAILABLE: String(7 * gib / 1024 + 1) }).status, 0);
});

for (const [name, env] of Object.entries({
  "one KiB below required space": { TEST_AVAILABLE: String(7 * gib / 1024 - 1) },
  "incident 3.7 GiB available": { TEST_AVAILABLE: String(Math.floor(3.7 * gib / 1024)) },
  "zero available space": { TEST_AVAILABLE: "0" },
  "root reserve breached despite ample Docker storage": { TEST_ROOT_AVAILABLE: String(Math.floor(3.7 * gib / 1024)), TEST_AVAILABLE: String(84 * gib / 1024) },
  "worker size counts without reuse credit": { TEST_WORKER: String(2 * gib) },
  "missing Docker root": { TEST_DOCKER_ROOT: "" },
  "relative Docker root": { TEST_DOCKER_ROOT: "var/lib/docker" },
  "nonexistent Docker root": { TEST_DOCKER_ROOT: path.join(directory, "missing") },
  "multiline Docker root": { TEST_DOCKER_ROOT: `${dockerRoot}\n/another` },
  "Docker info failure": { TEST_INFO_FAIL: "1" },
  "df failure": { TEST_DF_FAIL: "1" },
  "missing free space": { TEST_AVAILABLE: "" },
  "malformed free space": { TEST_AVAILABLE: "unknown" },
  "negative free space": { TEST_AVAILABLE: "-1" },
  "overflow free space": { TEST_AVAILABLE: "9223372036854775807" },
  "image inspection failure": { TEST_INSPECT_FAIL: "1" },
  "zero image size": { TEST_WEB: "0" },
  "invalid image size": { TEST_WORKER: "NaN" },
  "overflow image size": { TEST_WEB: "9223372036854775807" },
  "unknown driver": { TEST_DRIVER: "unknown" },
  "unknown image store": { TEST_STORE: "unknown" },
  "containerd driver without store identification": { TEST_DRIVER: "overlayfs" },
})) test(`headroom guard blocks ${name}`, () => {
  const result = run(env);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /SAVE\n|LOAD\n|REBUILD\n/);
});

test("containerd checks both data roots and safely quotes the explicit store path", () => {
  const result = run({ TEST_DRIVER: "overlayfs", TEST_STORE: "io.containerd.snapshotter.v1",
    SINGLE_VPS_CONTAINERD_ROOT: containerdRoot });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes(`DF ${dockerRoot}\n`));
  assert.ok(result.stderr.includes(`DF ${containerdRoot}\n`));
  assert.match(result.stderr, /LOAD\n/);
});

for (const [name, env] of Object.entries({
  "no verified containerd root": {},
  "relative containerd root": { SINGLE_VPS_CONTAINERD_ROOT: "var/lib/containerd" },
  "missing containerd directory": { SINGLE_VPS_CONTAINERD_ROOT: path.join(directory, "missing") },
  "multiline containerd root": { SINGLE_VPS_CONTAINERD_ROOT: `${containerdRoot}\n/tmp` },
  "containerd filesystem lacks headroom": { SINGLE_VPS_CONTAINERD_ROOT: containerdRoot, TEST_CONTAINERD_AVAILABLE: String(7 * gib / 1024 - 1) },
  "Docker metadata filesystem lacks headroom": { SINGLE_VPS_CONTAINERD_ROOT: containerdRoot, TEST_AVAILABLE: String(7 * gib / 1024 - 1) },
  "containerd df output invalid": { SINGLE_VPS_CONTAINERD_ROOT: containerdRoot, TEST_CONTAINERD_AVAILABLE: "invalid" },
})) test(`containerd import fails closed: ${name}`, () => {
  const result = run({ TEST_DRIVER: "overlayfs", TEST_STORE: "io.containerd.snapshotter.v1", ...env });
  assert.notEqual(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /SAVE\n|LOAD\n|REBUILD\n/);
});
