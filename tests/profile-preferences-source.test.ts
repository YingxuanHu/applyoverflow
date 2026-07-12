import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("job preferences live with the profile application surface", () => {
  const profilePage = readRepoFile("src/app/profile/page.tsx");
  const settingsPage = readRepoFile("src/app/settings/page.tsx");
  const navSidebar = readRepoFile("src/components/layout/nav-sidebar.tsx");
  const profileForm = readRepoFile("src/components/profile/profile-form.tsx");

  assert.match(profilePage, /<PreferencesForm/);
  assert.match(profilePage, /<ProfileForm/);
  assert.match(profilePage, /id="job-preferences"/);
  assert.match(profilePage, /Application profile/);
  assert.match(profileForm, /export function ProfileForm/);
  assert.match(navSidebar, /profile\?tab=details#job-preferences/);
  assert.doesNotMatch(navSidebar, /settings#job-preferences/);
  assert.doesNotMatch(settingsPage, /id="job-preferences"/);
});
