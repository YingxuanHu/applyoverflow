import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("application reminders are editable first-class workspace items", () => {
  const trackerSource = readRepoFile("src/lib/queries/tracker.ts");
  const actionsSource = readRepoFile("src/app/applications/[id]/actions.ts");
  const workspaceSource = readRepoFile("src/components/applications/workspace-client.tsx");

  assert.match(trackerSource, /updateTrackedApplicationEvent/);
  assert.match(actionsSource, /export async function updateTimelineEvent/);
  assert.match(actionsSource, /typeRaw === "REMINDER"[\s\S]*Reminder text is required/);
  assert.match(workspaceSource, /function RemindersSection/);
  assert.match(workspaceSource, /addTimelineEvent/);
  assert.match(workspaceSource, /updateTimelineEvent/);
  assert.match(workspaceSource, />Reminders</);
  assert.doesNotMatch(workspaceSource, /label="Notes"/);
});

test("applications dashboard search includes reminders, tags, and job fields", () => {
  const trackerSource = readRepoFile("src/lib/queries/tracker.ts");
  const pageSource = readRepoFile("src/app/applications/page.tsx");
  const searchFieldSource = readRepoFile(
    "src/components/applications/applications-search-field.tsx"
  );
  const summarySource = readRepoFile(
    "src/components/applications/application-reminders-summary.tsx"
  );

  assert.match(trackerSource, /search\?: string/);
  assert.match(trackerSource, /export type TrackerSearchScope/);
  assert.match(trackerSource, /titleSearch\?: string/);
  assert.match(trackerSource, /companySearch\?: string/);
  assert.match(trackerSource, /locationSearch\?: string/);
  assert.match(trackerSource, /tagSearch\?: string/);
  assert.match(trackerSource, /reminderSearch\?: string/);
  assert.match(trackerSource, /buildTrackedSearchTokens/);
  assert.match(trackerSource, /tokenConditions\.length === 1 \? tokenConditions\[0\] : \{ AND: tokenConditions \}/);
  assert.match(trackerSource, /buildScopedTrackedSearchWhere/);
  assert.match(trackerSource, /events:\s*\{\s*some:\s*\{\s*type: "REMINDER"/);
  assert.match(trackerSource, /tags:\s*\{\s*some:/);
  assert.match(pageSource, /ApplicationsSearchField/);
  assert.match(pageSource, /buildActiveApplicationSearchChips/);
  assert.match(searchFieldSource, /name="searchScope"/);
  assert.match(searchFieldSource, /titleSearch/);
  assert.match(searchFieldSource, /companySearch/);
  assert.match(searchFieldSource, /locationSearch/);
  assert.match(searchFieldSource, /tagSearch/);
  assert.match(searchFieldSource, /\{ label: "All", value: "all" \}/);
  assert.doesNotMatch(searchFieldSource, /label: "Reminder"/);
  assert.doesNotMatch(searchFieldSource, /reminder: "reminderSearch"/);
  assert.match(pageSource, /ApplicationRemindersSummary/);
  assert.match(summarySource, /line-clamp-2/);
  assert.match(summarySource, /updateTimelineEvent/);
  assert.match(summarySource, /deleteTimelineEvent/);
});
