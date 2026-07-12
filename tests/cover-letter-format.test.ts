import { describe, it } from "node:test";
import { match, strictEqual } from "node:assert";

import {
  ensureCoverLetterFormat,
} from "../src/lib/ai/cover-letter-format";
import {
  buildCoverLetterDocFileName,
  buildCoverLetterDocHtml,
  buildCoverLetterDocxBytes,
  buildCoverLetterDocxFileName,
  buildCoverLetterPdfBytes,
  buildCoverLetterPdfFileName,
} from "../src/lib/ai/cover-letter-doc-html";
import {
  getCoverLetterJobContextIssue,
  hasUsableCoverLetterJobContext,
} from "../src/lib/ai/cover-letter-readiness";

describe("ensureCoverLetterFormat", () => {
  it("adds the required greeting and user signature", () => {
    const formatted = ensureCoverLetterFormat(
      "I can help this team ship faster with clear product engineering work.",
      { fullName: "Yingxuan Hu" }
    );

    strictEqual(
      formatted,
      [
        "Hi [name],",
        "",
        "I can help this team ship faster with clear product engineering work.",
        "",
        "Sincerely,",
        "Yingxuan Hu",
      ].join("\n")
    );
  });

  it("replaces existing salutation and closing instead of duplicating them", () => {
    const formatted = ensureCoverLetterFormat(
      "Dear Hiring Manager,\n\nThis role matches my experience.\n\nBest regards,\nOld Name",
      { fullName: "Yingxuan Hu" }
    );

    strictEqual(formatted.startsWith("Hi [name],\n\nThis role"), true);
    strictEqual(formatted.endsWith("Sincerely,\nYingxuan Hu"), true);
    strictEqual(formatted.includes("Dear Hiring Manager"), false);
    strictEqual(formatted.includes("Old Name"), false);
  });

  it("collapses multiple generated closings into one app signature", () => {
    const formatted = ensureCoverLetterFormat(
      [
        "Hi [name],",
        "",
        "This role matches my experience.",
        "",
        "Best,",
        "Yingxuan Hu",
        "",
        "Sincerely,",
        "Yingxuan Hu",
      ].join("\n"),
      { fullName: "Yingxuan Hu" }
    );

    strictEqual(
      formatted,
      [
        "Hi [name],",
        "",
        "This role matches my experience.",
        "",
        "Sincerely,",
        "Yingxuan Hu",
      ].join("\n")
    );
  });

  it("normalizes same-line salutations", () => {
    const formatted = ensureCoverLetterFormat(
      "Hi Hiring Team, This role is a strong fit.",
      { fullName: "Yingxuan Hu" }
    );

    strictEqual(formatted.includes("Hi Hiring Team"), false);
    strictEqual(formatted, "Hi [name],\n\nThis role is a strong fit.\n\nSincerely,\nYingxuan Hu");
  });
});

describe("buildCoverLetterDocHtml", () => {
  it("creates a Word-compatible HTML document with escaped text", () => {
    const html = buildCoverLetterDocHtml("Hi [name],\n\nA < B & C > D");

    match(html, /<!DOCTYPE html>/);
    match(html, /application\/msword|Cover Letter|font-family/);
    match(html, /A &lt; B &amp; C &gt; D/);
  });
});

describe("buildCoverLetterDocFileName", () => {
  it("creates a .doc filename from the generated document title", () => {
    strictEqual(
      buildCoverLetterDocFileName("AI cover letter — Acme Corp · Backend Engineer"),
      "AI-cover-letter-Acme-Corp-Backend-Engineer.doc"
    );
  });

  it("creates .docx and .pdf filenames from the generated document title", () => {
    strictEqual(
      buildCoverLetterDocxFileName("AI cover letter — Acme Corp · Backend Engineer"),
      "AI-cover-letter-Acme-Corp-Backend-Engineer.docx"
    );
    strictEqual(
      buildCoverLetterPdfFileName("AI cover letter — Acme Corp · Backend Engineer"),
      "AI-cover-letter-Acme-Corp-Backend-Engineer.pdf"
    );
  });
});

describe("cover letter binary downloads", () => {
  it("creates a DOCX zip payload and PDF payload", () => {
    const docx = buildCoverLetterDocxBytes("Hi [name],\n\nA focused cover letter.");
    const pdf = buildCoverLetterPdfBytes("Hi [name],\n\nA focused cover letter.");

    strictEqual(String.fromCharCode(...docx.slice(0, 2)), "PK");
    strictEqual(new TextDecoder().decode(pdf.slice(0, 8)), "%PDF-1.4");
  });
});

describe("cover letter readiness", () => {
  it("requires a usable job description", () => {
    strictEqual(hasUsableCoverLetterJobContext(null), false);
    strictEqual(
      hasUsableCoverLetterJobContext({
        description: "No full job description is available for this tracked application.",
      }),
      false
    );
    strictEqual(
      getCoverLetterJobContextIssue({
        description: "Short",
      }),
      "A usable job description is required before generating a tailored cover letter."
    );
    strictEqual(
      hasUsableCoverLetterJobContext({
        description:
          "This role owns backend services, builds reliable product workflows, partners with design and product, and improves production systems for customers.",
      }),
      true
    );
  });
});
