// Tests for the small, deterministic helper that builds distinguishing names
// for AI-generated documents. We need predictable titles so the user can scan
// their Documents tab and immediately see *which* job the AI tailored a
// resume / cover letter for, and so we can filter "AI generated" cleanly in
// the UI.

import { describe, it } from "node:test";
import { strictEqual } from "node:assert";

import { buildAiGeneratedDocumentTitle } from "../src/lib/ai-document-naming";

describe("buildAiGeneratedDocumentTitle", () => {
  it("builds a resume title with company and role", () => {
    strictEqual(
      buildAiGeneratedDocumentTitle({
        kind: "RESUME",
        company: "Acme Corp",
        roleTitle: "Senior Software Engineer",
      }),
      "AI tailored resume — Acme Corp · Senior Software Engineer"
    );
  });

  it("builds a cover letter title with company and role", () => {
    strictEqual(
      buildAiGeneratedDocumentTitle({
        kind: "COVER_LETTER",
        company: "Acme Corp",
        roleTitle: "Senior Software Engineer",
      }),
      "AI cover letter — Acme Corp · Senior Software Engineer"
    );
  });

  it("trims and collapses whitespace in inputs", () => {
    strictEqual(
      buildAiGeneratedDocumentTitle({
        kind: "RESUME",
        company: "  Acme   Corp  ",
        roleTitle: "  Senior \t Engineer ",
      }),
      "AI tailored resume — Acme Corp · Senior Engineer"
    );
  });

  it("omits the role section when role is empty", () => {
    strictEqual(
      buildAiGeneratedDocumentTitle({
        kind: "RESUME",
        company: "Acme",
        roleTitle: "",
      }),
      "AI tailored resume — Acme"
    );
  });

  it("falls back to a clear placeholder when both company and role are empty", () => {
    strictEqual(
      buildAiGeneratedDocumentTitle({
        kind: "COVER_LETTER",
        company: "",
        roleTitle: "",
      }),
      "AI cover letter"
    );
  });

  it("truncates overly long inputs so titles stay readable", () => {
    const title = buildAiGeneratedDocumentTitle({
      kind: "RESUME",
      company: "A".repeat(120),
      roleTitle: "B".repeat(120),
    });
    // Title should never exceed 180 chars; we soft-cap each segment.
    strictEqual(title.length <= 180, true, `title was ${title.length} chars`);
  });
});
