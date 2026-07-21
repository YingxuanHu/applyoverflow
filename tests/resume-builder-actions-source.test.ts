import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("resume builder actions keep profile sync, AI proposals, and PDF output explicit", () => {
  const actions = readRepoFile("src/app/profile/resume-builder-actions.ts");

  assert.match(actions, /export async function generateResumeEntryVariation/);
  assert.match(actions, /approvalStatus: "PENDING"/);
  assert.match(actions, /export async function approveResumeEntryVariation/);
  assert.match(actions, /export async function generateResumeBuildPdf/);
  assert.match(actions, /generateUnifiedResumeTeX/);
  assert.match(actions, /RESUME_BUILD_SECTION_ORDER/);
});
