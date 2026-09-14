import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../src/components/${path}`, import.meta.url), "utf8");

test("auth shell mounts a single form so labels and browser autofill are unambiguous", () => {
  const shell = read("auth/auth-shell.tsx");
  assert.equal(shell.match(/\{children\}/g)?.length, 1);
  assert.doesNotMatch(shell, /<main/);
  for (const form of ["sign-in-form", "sign-up-form", "forgot-password-form", "reset-password-form", "verify-email-card"]) {
    assert.match(read(`auth/${form}.tsx`), /<CardTitle role="heading" aria-level=\{1\}/);
  }
});

test("mobile account and application controls retain accessible names", () => {
  assert.match(read("layout/user-menu.tsx"), /aria-label=\{`Account menu for/);
  const tracker = read("applications/applications-page-client.tsx");
  assert.match(tracker, /sr-only sm:not-sr-only sm:block">\s*Status/);
  assert.match(tracker, /sr-only sm:not-sr-only sm:block">\s*Sort/);
  assert.match(read("applications/workspace-client.tsx"), /aria-label="Application status"/);
});

test("resume builder loading uses the root main landmark", () => {
  const loading = readFileSync(new URL("../src/app/documents/resume-builder/loading.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(loading, /<main/);
  assert.match(loading, /aria-busy="true"/);
});

test("theme options use native radios for arrow-key navigation", () => {
  const theme = read("layout/theme-toggle.tsx");
  assert.match(theme, /type="radio"/);
  assert.match(theme, /name=\{groupName\}/);
  assert.match(theme, /peer-focus-visible:outline/);
  assert.doesNotMatch(theme, /transition-transform/);
});
