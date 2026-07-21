import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("documents have a dedicated workspace separate from the application profile", () => {
  const documentsPage = readRepoFile("src/app/documents/page.tsx");
  const resumeBuilderPage = readRepoFile("src/app/documents/resume-builder/page.tsx");
  const profilePage = readRepoFile("src/app/profile/page.tsx");
  const sidebar = readRepoFile("src/components/layout/nav-sidebar.tsx");
  const mobileNav = readRepoFile("src/components/layout/mobile-nav-sheet.tsx");
  const revalidation = readRepoFile("src/lib/revalidation.ts");
  const proxy = readRepoFile("src/proxy.ts");

  assert.match(documentsPage, /<h1 className="page-title">Documents<\/h1>/);
  assert.match(documentsPage, /Resume builder/);
  assert.match(documentsPage, /href="\/documents\/resume-builder"/);
  assert.match(documentsPage, /Resume files &amp; templates/);
  assert.doesNotMatch(documentsPage, /<ResumeBuilder/);
  assert.match(documentsPage, /Cover letter library/);
  assert.match(documentsPage, /href="\/documents\/compare"/);

  assert.match(resumeBuilderPage, /<ResumeBuilder/);
  assert.match(resumeBuilderPage, /outputDocument/);
  assert.match(resumeBuilderPage, /approvalStatus: \{ not: "REJECTED" \}/);

  assert.match(profilePage, /Personal information, experience, and job preferences/);
  assert.match(profilePage, /<PreferencesForm/);
  assert.match(profilePage, /<ProfileForm/);
  assert.doesNotMatch(profilePage, /<ResumeManager/);
  assert.doesNotMatch(profilePage, /<CoverLetterManager/);
  assert.doesNotMatch(profilePage, /TabsContent value="documents"/);

  assert.match(sidebar, /href: "\/documents", label: "Documents"/);
  assert.doesNotMatch(sidebar, /profile\?tab=documents/);
  assert.match(mobileNav, /href: "\/documents"/);
  assert.doesNotMatch(mobileNav, /useSearchParams/);
  assert.match(revalidation, /"\/documents"/);
  assert.match(revalidation, /"\/documents\/resume-builder"/);
  assert.match(revalidation, /"\/documents\/compare"/);
  assert.match(proxy, /"\/documents"/);
});
