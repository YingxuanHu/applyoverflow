import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("manual application add form refreshes on every successful create", () => {
  const formSource = readRepoFile(
    "src/components/dashboard/create-tracked-application-form.tsx"
  );
  const routeSource = readRepoFile("src/app/api/applications/route.ts");
  const trackerSource = readRepoFile("src/lib/queries/tracker.ts");

  assert.match(routeSource, /export async function POST/);
  assert.match(routeSource, /const createdApplication = await createTrackedApplication/);
  assert.match(routeSource, /applicationId: createdApplication\.id/);

  assert.match(formSource, /onSubmit=\{handleSubmit\}/);
  assert.match(formSource, /fetch\("\/api\/applications"/);
  assert.match(formSource, /finally \{/);
  assert.match(formSource, /setPending\(false\)/);
  assert.match(formSource, /router\.refresh\(\)/);
  assert.match(formSource, /<SubmitButton pending=\{pending\}/);
  assert.doesNotMatch(formSource, /useActionState/);
  assert.doesNotMatch(formSource, /useFormStatus/);

  assert.match(trackerSource, /function queueReminderCheck/);
  assert.match(trackerSource, /void checkSingleTrackedApplicationReminder/);
});

test("job-page add to applications menu clears pending state and refreshes", () => {
  const menuSource = readRepoFile("src/components/jobs/manual-apply-menu.tsx");

  assert.match(menuSource, /useRouter/);
  assert.match(menuSource, /fetch\(`\/api\/jobs\/\$\{jobId\}\/save`/);
  assert.match(menuSource, /router\.refresh\(\)/);
  assert.match(menuSource, /\.finally\(\(\) => setSaving\(false\)\)/);
  assert.match(menuSource, /saving \? "Adding\.\.\." : "Add to applications"/);
});
