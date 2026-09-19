import assert from "node:assert/strict";
import test from "node:test";
import {
  canShareExtensionResume,
  EXTENSION_RESUME_MAX_BYTES,
  resumeTransferFilename,
  resumeRequestSchema,
  resumeExchangeSchema,
} from "../src/lib/extension-resume";

const pdf = {
  type: "RESUME",
  mimeType: "application/pdf",
  originalFileName: "resume.pdf",
  sizeBytes: 3000,
};
test("resume sharing accepts only bounded resume files with matching MIME/extension", () => {
  assert.equal(canShareExtensionResume(pdf), true);
  assert.equal(
    canShareExtensionResume({
      ...pdf,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      originalFileName: "Resume.DOCX",
    }),
    true,
  );
  for (const changes of [
    { type: "COVER_LETTER" },
    { type: "RESUME_TEMPLATE" },
    { mimeType: "text/html" },
    { originalFileName: "resume.docx" },
    { originalFileName: "resume.pdf.html" },
    { sizeBytes: 0 },
    { sizeBytes: EXTENSION_RESUME_MAX_BYTES + 1 },
  ])
    assert.equal(canShareExtensionResume({ ...pdf, ...changes }), false);
});
test("shared resume filenames cannot contain paths, controls, or a disguised extension", () => {
  assert.equal(
    resumeTransferFilename("../../Jordan Resume.PDF", "application/pdf"),
    "Jordan Resume.pdf",
  );
  assert.equal(
    resumeTransferFilename(
      "C:\\resumes\\Jordan\nResume.pdf",
      "application/pdf",
    ),
    "Jordan_Resume.pdf",
  );
  assert.ok(
    resumeTransferFilename("a".repeat(500) + ".pdf", "application/pdf")
      .length <= 124,
  );
});
test("resume requests require a supported posting, state and PKCE; no caller-supplied file URL", () => {
  const input = {
    url: "https://job-boards.greenhouse.io/fixture/jobs/123",
    state: "a".repeat(43),
    challenge: "b".repeat(43),
  };
  assert.equal(resumeRequestSchema.safeParse(input).success, true);
  assert.equal(
    resumeRequestSchema.safeParse({
      ...input,
      url: "https://evil.test/file.pdf",
    }).success,
    false,
  );
  assert.equal(
    resumeRequestSchema.safeParse({ ...input, storageKey: "other-user/resume" })
      .success,
    false,
  );
  assert.equal(
    resumeExchangeSchema.safeParse({
      url: input.url,
      id: "document",
      code: "x",
      verifier: "y",
    }).success,
    false,
  );
});
