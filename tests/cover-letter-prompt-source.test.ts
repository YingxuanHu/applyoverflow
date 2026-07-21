import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("cover letter generation builds a strategic case instead of a prose resume", () => {
  const source = readRepoFile("src/lib/ai/cover-letter.ts");

  assert.match(source, /evidence bank, not an outline/);
  assert.match(source, /one clear, role-specific thesis/);
  assert.match(source, /1 or 2 high-value pieces of evidence at most/);
  assert.match(source, /forward-looking contribution/);
  assert.match(source, /modelFlavor: "reasoning"/);
});
