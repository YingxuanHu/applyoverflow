import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const previous = "a".repeat(40), revision = "b".repeat(40);
const previousImage = `sha256:${"1".repeat(64)}`, currentImage = `sha256:${"2".repeat(64)}`;
const web = `ghcr.io/yingxuanhu/applyoverflow-web@sha256:${"3".repeat(64)}`;
const migrations = `ghcr.io/yingxuanhu/applyoverflow-migrations@sha256:${"4".repeat(64)}`;
const script = resolve("deploy/ci/remote-release.sh");

// Run the actual release shell against an isolated fake Docker host. No SSH,
// network, real containers, or production credentials are involved.
function fixture(t, scenario = "success") {
  const root = mkdtempSync(join(tmpdir(), "ao-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "deploy/single-vps"), { recursive: true });
  writeFileSync(join(root, "deploy/single-vps/docker-compose.yml"), "services: {}\n");
  writeFileSync(join(root, "deploy/single-vps/.env.production"), "TEST_ONLY=true\n");
  writeFileSync(join(root, "mock.json"), JSON.stringify({ image: previousImage, revision: previous }));
  const mock = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const root = process.env.DEPLOY_ROOT, args = process.argv.slice(2);
const command = path.basename(process.argv[1]);
const scenario = process.env.SCENARIO;
const file = path.join(root, 'mock.json');
let state = JSON.parse(fs.readFileSync(file));
fs.appendFileSync(path.join(root, 'commands.jsonl'), JSON.stringify([command, ...args]) + '\\n');
if (command === 'flock') process.exit(scenario === 'locked' ? 1 : 0);
if (command === 'df') { console.log('Filesystem 1024-blocks Used Available Capacity Mounted on\\ntest 99999999 0 ' + (scenario === 'disk-full' ? 100 : 99999999) + ' 1% /'); process.exit(); }
if (command === 'curl') {
  console.log(JSON.stringify({ status: 'ready', revision: scenario === 'public-mismatch' && state.revision === '${revision}' ? 'wrong' : state.revision })); process.exit();
}
if (args[0] === 'compose') {
  if (args.includes('ps')) { console.log('app-container'); process.exit(); }
  if (args.includes('up')) {
    const override = args[args.lastIndexOf('-f') + 1];
    const image = fs.readFileSync(override, 'utf8').match(/image: "([^"]+)"/)[1];
    const isPrevious = image === '${previousImage}';
    state = {image: isPrevious ? '${previousImage}' : '${currentImage}', revision: isPrevious ? '${previous}' : '${revision}'};
    fs.writeFileSync(file, JSON.stringify(state));
    if ((scenario === 'start-fails' && !isPrevious) || (scenario === 'rollback-fails' && isPrevious)) process.exit(1);
    process.exit();
  }
}
if (args[0] === 'inspect') { console.log(state.image); process.exit(); }
if (args[0] === 'exec') {
  const expected = args.at(-1);
  if (!/^[ab]{40}$/.test(expected)) { console.log(state.revision); process.exit(); }
  if ((scenario === 'unhealthy' || scenario === 'rollback-fails') && expected === '${revision}') process.exit(1);
  process.exit(expected === state.revision ? 0 : 1);
}
if (args[0] === 'info') { console.log(root); process.exit(); }
if (args[0] === 'login') {
  const token = fs.readFileSync(0, 'utf8');
  if (!token.trim()) process.exit(1);
  fs.writeFileSync(path.join(process.env.DOCKER_CONFIG, 'config.json'), token); process.exit();
}
if (args[0] === 'pull') process.exit(scenario === 'pull-fails' ? 1 : 0);
if (args[0] === 'image' && args[1] === 'tag') process.exit();
if (args[0] === 'image' && args[1] === 'inspect') {
  if (args.includes('--format')) {
    if (args[3] === '{{.Id}}') console.log(args.at(-1) === '${previousImage}' ? '${previousImage}' : '${currentImage}');
    else console.log(args[3].includes('Architecture') ? (scenario === 'wrong-platform' ? 'linux/arm64' : 'linux/amd64') : (scenario === 'wrong-revision' ? '${previous}' : '${revision}'));
  }
  process.exit();
}
if (args[0] === 'run') {
  if (args.includes('${migrations}') && scenario === 'pending-migration') process.exit(1);
  if (args.includes('${web}') && scenario === 'pdf-fails') process.exit(1);
  process.exit();
}
console.error('Unexpected Docker invocation', args); process.exit(99);
`;
  for (const name of ["docker", "curl", "df", "flock"]) writeFileSync(join(bin, name), mock, { mode: 0o755 });
  const run = (args = ["deploy", revision, web, migrations, "YingxuanHu"]) => spawnSync("bash", [script, ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_ROOT: root, SCENARIO: scenario, HEALTH_ATTEMPTS: "2", HEALTH_DELAY: "0" },
    input: "ephemeral-registry-token\n", encoding: "utf8", timeout: 20_000,
  });
  const state = () => JSON.parse(readFileSync(join(root, "mock.json")));
  const calls = () => readFileSync(join(root, "commands.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { root, run, state, calls };
}

test("deploy and manual rollback preserve healthy images without touching workers", t => {
  const f = fixture(t);
  const release = f.run();
  assert.equal(release.status, 0, release.stderr);
  assert.equal(f.state().revision, revision);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, ".github-deploy/previous.json"))), { image: previousImage, revision: previous });
  assert.ok(!readdirSync(join(f.root, ".github-deploy")).some(name => name.startsWith("attempt.")), "Temporary registry credentials must be removed");
  const rollback = f.run(["rollback"]);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(f.state().revision, previous);
  for (const call of f.calls().filter(call => call.includes("up"))) {
    assert.equal(call.at(-1), "app");
    assert.ok(call.includes("--no-deps") && call.includes("--no-build"));
  }
  assert.ok(!f.calls().some(call => call.includes("prune") || call.includes("down")));
});

for (const scenario of ["disk-full", "pull-fails", "wrong-platform", "wrong-revision", "pending-migration", "pdf-fails", "locked"]) {
  test(`${scenario} fails before switching the running app`, t => {
    const f = fixture(t, scenario), result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(f.state().revision, previous);
    assert.ok(!f.calls().some(call => call.includes("up")), result.stderr);
  });
}

for (const scenario of ["unhealthy", "public-mismatch", "start-fails"]) {
  test(`${scenario} rolls back but still reports a failed release`, t => {
    const f = fixture(t, scenario), result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(f.state().revision, previous);
    assert.match(result.stderr, /Rollback verified/);
    assert.equal(f.calls().filter(call => call.includes("up")).length, 2);
  });
}

test("rollback failure gives an explicit operator alert", t => {
  const f = fixture(t, "rollback-fails"), result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CRITICAL: rollback could not be verified/);
});

test("mutable image tags and shell-injected revisions are rejected", t => {
  const f = fixture(t);
  for (const args of [["deploy", revision, "ghcr.io/yingxuanhu/applyoverflow-web:latest", migrations, "YingxuanHu"], ["deploy", "main; echo unsafe", web, migrations, "YingxuanHu"]]) {
    assert.notEqual(f.run(args).status, 0);
  }
  assert.ok(!f.calls().some(call => call.includes("pull") || call.includes("up")));
});

test("manual rollback requires a saved known-good revision", t => {
  const f = fixture(t), result = f.run(["rollback"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No previous successful deployment/);
  assert.ok(!f.calls().some(call => call.includes("up")));
});

test("releasing the same image twice preserves the rollback target", t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Image already deployed/);
  assert.equal(JSON.parse(readFileSync(join(f.root, ".github-deploy/previous.json"))).revision, previous);
  assert.equal(f.calls().filter(call => call.includes("up")).length, 1);
});

test("a manual deployment invalidates automatic rollback assumptions", t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  writeFileSync(join(f.root, "mock.json"), JSON.stringify({ image: previousImage, revision: previous }));
  const result = f.run(["rollback"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Running app changed outside CI/);
  assert.equal(f.calls().filter(call => call.includes("up")).length, 1);
});
