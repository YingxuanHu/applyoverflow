import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("resume builder actions keep profile sync, working-copy edits, AI rewrites, and PDF output explicit", () => {
  const actions = readRepoFile("src/app/profile/resume-builder-actions.ts");

  assert.match(actions, /export async function updateResumeLibraryEntry/);
  assert.match(actions, /export async function generateResumeEntryVariation/);
  assert.match(actions, /approvalStatus: "PENDING"/);
  assert.match(actions, /buildProfileContext\(\)/);
  assert.match(actions, /buildAiProfileText\(profileContext\)/);
  assert.match(actions, /export async function applyResumeEntryRewrite/);
  assert.match(actions, /export async function dismissResumeEntryRewrite/);
  assert.match(actions, /export async function generateResumeBuildPdf/);
  assert.match(actions, /generateUnifiedResumeTeX/);
  assert.match(actions, /RESUME_BUILD_SECTION_ORDER/);
});
