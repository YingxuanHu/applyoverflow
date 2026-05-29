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
  const actionSource = readRepoFile("src/app/dashboard/actions.ts");

  assert.match(actionSource, /createdApplicationId: string \| null/);
  assert.match(actionSource, /const createdApplication = await createTrackedApplication/);
  assert.match(actionSource, /createdApplicationId: createdApplication\.id/);

  assert.match(formSource, /const \[state, action, pending\] = useActionState/);
  assert.match(formSource, /createdApplicationId: null/);
  assert.match(formSource, /state\.createdApplicationId/);
  assert.match(formSource, /<SubmitButton pending=\{pending\}/);
  assert.doesNotMatch(formSource, /useFormStatus/);
});
