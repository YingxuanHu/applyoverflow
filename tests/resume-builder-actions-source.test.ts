import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("resume builder actions keep profile imports one-way, versions immutable, and PDF output explicit", () => {
  const actions = readRepoFile("src/app/profile/resume-builder-actions.ts");

  assert.match(actions, /export async function importResumeLibraryFromProfile/);
  assert.match(actions, /Existing resume entries were not changed/);
  assert.match(actions, /export async function updateResumeLibraryEntry/);
  assert.match(actions, /export async function generateResumeEntryVariation/);
  assert.match(actions, /selectedBulletIds/);
  assert.match(actions, /sourceVariationId: baseVariation\.id/);
  assert.match(actions, /rewrittenBulletIndexes: selectedBulletIndexes/);
  assert.match(actions, /approvalStatus: "PENDING"/);
  assert.match(actions, /buildProfileContext\(\)/);
  assert.match(actions, /buildAiProfileText\(profileContext\)/);
  assert.match(actions, /export async function applyResumeEntryRewrite/);
  assert.match(actions, /Only the AI-selected bullets can be edited in this review/);
  assert.match(actions, /export async function dismissResumeEntryRewrite/);
  assert.match(actions, /export async function duplicateResumeEntryVariation/);
  assert.match(actions, /export async function renameResumeEntryVariation/);
  assert.match(actions, /export async function setDefaultResumeEntryVariation/);
  assert.match(actions, /export async function deleteResumeEntryVariation/);
  assert.match(actions, /export async function deleteResumeEntryBullet/);
  assert.match(actions, /export async function generateResumeBuildPdf/);
  assert.match(actions, /generateUnifiedResumeTeX/);
  assert.match(actions, /RESUME_BUILD_SECTION_ORDER/);

  const manualVersionAction = actions.slice(
    actions.indexOf("export async function updateResumeLibraryEntry"),
    actions.indexOf("export async function generateResumeEntryVariation")
  );
  assert.match(manualVersionAction, /resumeLibraryEntryVariation\.create/);
  assert.doesNotMatch(manualVersionAction, /resumeLibraryEntry\.update/);
});
