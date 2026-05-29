import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("proxy validates signed sessions without importing the full auth stack", () => {
  const proxySource = readRepoFile("src/proxy.ts");

  assert.doesNotMatch(proxySource, /@\/lib\/auth/);
  assert.match(proxySource, /verifySignedCookieValue/);
  assert.match(proxySource, /prisma\.session\.findUnique/);
  assert.match(proxySource, /expiresAt > new Date\(\)/);
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
