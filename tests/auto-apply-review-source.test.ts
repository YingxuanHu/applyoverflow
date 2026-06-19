import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("auto-apply review flow exposes simple user statuses and editable field sources", () => {
  const typesSource = readRepoFile("src/lib/automation/types.ts");
  const reviewSource = readRepoFile("src/lib/automation/review.ts");
  const statusSource = readRepoFile("src/lib/automation/user-status.ts");
  const workspaceSource = readRepoFile("src/components/jobs/auto-apply-workspace.tsx");

  assert.match(typesSource, /AUTO_APPLY_READY/);
  assert.match(typesSource, /NEEDS_EXTRA_ANSWERS/);
  assert.match(typesSource, /BLOCKED_OR_UNSUPPORTED/);
  assert.match(typesSource, /Manual input required/);
  assert.match(typesSource, /AutoApplyDetectedFieldType/);
  assert.match(typesSource, /options\?: string\[\]/);
  assert.match(typesSource, /reviewRequired/);
  assert.match(typesSource, /AutoApplyReviewField/);

  assert.match(reviewSource, /buildAutoApplyReviewSummary/);
  assert.match(reviewSource, /missingRequiredFields/);
  assert.match(reviewSource, /canSubmit/);
  assert.match(reviewSource, /isSensitiveFieldLabel/);
  assert.match(reviewSource, /getAutoApplyReadinessCopy/);
  assert.match(statusSource, /resolveAutoApplyUserStatus/);
  assert.match(statusSource, /Needs Info/);
  assert.match(statusSource, /Auto Apply/);
  assert.match(statusSource, /Manual Apply/);
  assert.match(reviewSource, /editable: true/);

  assert.match(workspaceSource, /Prepare application/);
  assert.match(workspaceSource, /Application fields/);
  assert.match(workspaceSource, /Confirm and submit/);
  assert.match(workspaceSource, /I reviewed the selected resume/);
  assert.match(workspaceSource, /resolveAutoApplyUserStatus/);
  assert.match(workspaceSource, /Developer details/);
  assert.match(workspaceSource, /debug/);
  assert.match(workspaceSource, /searchParams\.get\("debug"\) !== "1"/);
  assert.match(workspaceSource, /Generate draft answer/);
  assert.doesNotMatch(workspaceSource, /Cannot auto-apply/);
  assert.doesNotMatch(workspaceSource, /Ready to submit/);
  assert.doesNotMatch(workspaceSource, /NEEDS_EXTRA_ANSWERS[\s\S]*missingAnswersComplete/);
});

test("internal eligibility candidates are not exposed as verified Auto Apply", () => {
  const displaySource = readRepoFile("src/lib/job-display.ts");
  const detailPageSource = readRepoFile("src/app/jobs/[id]/page.tsx");
  const jobsPageSource = readRepoFile("src/app/jobs/page.tsx");

  assert.doesNotMatch(displaySource, /Auto-apply candidate/);
  assert.doesNotMatch(displaySource, /Auto Apply candidate/);
  assert.match(displaySource, /SubmissionCategory is an internal ingestion hint/);
  assert.match(displaySource, /return false/);

  assert.doesNotMatch(detailPageSource, />\s*Auto apply\s*</);
  assert.match(detailPageSource, /JobDetailActionGroup/);

  assert.doesNotMatch(jobsPageSource, /label: "Auto-apply"/);
  assert.doesNotMatch(jobsPageSource, /title="Apply type"/);
});

test("dry-run fillers inspect actual fields without filling or submitting", () => {
  const greenhouseSource = readRepoFile("src/lib/automation/fillers/greenhouse.ts");
  const leverSource = readRepoFile("src/lib/automation/fillers/lever.ts");
  const ashbySource = readRepoFile("src/lib/automation/fillers/ashby.ts");
  const detectionSource = readRepoFile("src/lib/automation/form-detection.ts");
  const fieldMapSource = readRepoFile("src/lib/automation/field-map.ts");

  for (const source of [greenhouseSource, leverSource, ashbySource]) {
    assert.match(source, /mode === "dry_run"/);
    assert.match(source, /detectMappedFieldsForReview/);
  }

  assert.match(ashbySource, /openAshbyApplicationForm/);
  assert.match(ashbySource, /\/application/);
  assert.match(detectionSource, /Unknown required question; user input required/);
  assert.match(detectionSource, /matchLabelToConcept/);
  assert.match(detectionSource, /savedAnswers/);
  assert.match(detectionSource, /input, textarea, select/);
  assert.match(detectionSource, /radio/);
  assert.match(detectionSource, /checkbox/);
  assert.match(detectionSource, /getSelectOptions/);
  assert.match(detectionSource, /getChoiceOptions/);
  assert.match(detectionSource, /requiresExplicitUserAnswer/);
  assert.match(fieldMapSource, /savedAnswerForConcept/);
  assert.match(fieldMapSource, /how_did_you_hear/);
});

test("Ashby submission path reuses dry-run field detection before it can submit", () => {
  const ashbySource = readRepoFile("src/lib/automation/fillers/ashby.ts");
  const routeSource = readRepoFile("src/app/api/jobs/[id]/auto-apply/route.ts");
  const applicationQueriesSource = readRepoFile("src/lib/queries/applications.ts");

  assert.match(ashbySource, /const detectedForReview = await detectMappedFieldsForReview/);
  assert.match(ashbySource, /mergeUnfillableFields\(unfillableFields, detectedForReview\.unfillable\)/);
  assert.match(ashbySource, /fillAshbyDetectedChoiceFields/);
  assert.match(routeSource, /confirmSubmission/);
  assert.match(ashbySource, /required_field_unknown/);

  assert.match(routeSource, /preparedPackage\.savedAnswers/);
  assert.match(applicationQueriesSource, /jsonValueToStringRecord\(latestPackage\?\.savedAnswers/);
});

test("Lever submission fills reviewed choice answers detected during preflight", () => {
  const leverSource = readRepoFile("src/lib/automation/fillers/lever.ts");

  assert.match(leverSource, /fillLeverDetectedChoiceFields/);
  assert.match(leverSource, /fieldType !== "select"/);
  assert.match(leverSource, /fieldType !== "radio"/);
  assert.match(leverSource, /fieldType !== "checkbox"/);
  assert.match(leverSource, /optionMatches/);
});

test("supported fillers preserve detected fields even when a blocker stops submission", () => {
  const greenhouseSource = readRepoFile("src/lib/automation/fillers/greenhouse.ts");
  const leverSource = readRepoFile("src/lib/automation/fillers/lever.ts");

  for (const source of [greenhouseSource, leverSource]) {
    const detectionIndex = source.indexOf(
      "const detectedForReview = await detectMappedFieldsForReview"
    );
    const blockedIndex = source.indexOf('makeResult(\n      "blocked"');

    assert.ok(detectionIndex > -1, "filler should compute detectedForReview");
    assert.ok(blockedIndex > -1, "filler should still return a blocked result");
    assert.ok(
      detectionIndex < blockedIndex,
      "filler should detect review fields before returning blocked"
    );
    assert.match(source, /detectedForReview\.filled/);
    assert.match(source, /detectedForReview\.unfillable/);
    assert.match(source, /02_blocked_analysis/);
  }
});

test("screenshot capture failures do not erase auto-apply preflight results", () => {
  const screenshotSource = readRepoFile("src/lib/automation/screenshots.ts");

  assert.match(screenshotSource, /try \{/);
  assert.match(screenshotSource, /page\.screenshot/);
  assert.match(screenshotSource, /unavailable\.txt/);
  assert.match(screenshotSource, /Screenshot unavailable/);
});
