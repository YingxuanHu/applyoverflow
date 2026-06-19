import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("proxy validates signed sessions without importing the full auth stack", () => {
  const proxySource = readRepoFile("src/proxy.ts");
  const sessionPolicySource = readRepoFile("src/lib/auth-session-policy.ts");

  assert.doesNotMatch(proxySource, /@\/lib\/auth["']/);
  assert.match(proxySource, /getVerifiedSessionTokenFromHeaders/);
  assert.match(proxySource, /isSessionUsableByPolicy/);
  assert.match(proxySource, /prisma\.session\.findUnique/);
  assert.match(proxySource, /createdAt:\s*true/);
  assert.match(proxySource, /updatedAt:\s*true/);
  assert.match(sessionPolicySource, /verifySignedCookieValue/);
  assert.match(sessionPolicySource, /SESSION_INACTIVITY_TIMEOUT_SECONDS/);
  assert.match(sessionPolicySource, /SESSION_MAX_LIFETIME_SECONDS/);
});

test("ops pages require ops admin authorization", () => {
  const opsPages = [
    "src/app/ops/discovery/page.tsx",
    "src/app/ops/health/page.tsx",
    "src/app/ops/ingestion/page.tsx",
    "src/app/ops/ranking/page.tsx",
  ];

  for (const path of opsPages) {
    const source = readRepoFile(path);

    assert.match(source, /requireOpsAdmin/);
  }
});
