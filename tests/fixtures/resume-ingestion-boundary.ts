import assert from "node:assert/strict";
import { ingestResumeIntoProfile, makeEmptyEditableProfile } from "../../src/lib/resume-ingestion";
import { pdfFixture } from "../../scripts/resume-parser-fixtures.mjs";

async function main() {
  // This subprocess has react-server enabled, but no database or live AI client.
  const existingProfile = makeEmptyEditableProfile({ name: "Preserved Name" });
  const input = { existingProfile, fileName: "resume.pdf", mimeType: "application/pdf" };
  process.env.OPENAI_API_KEY = "fake-test-key-never-send";
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("No network permitted in this test"); };
  await assert.rejects(ingestResumeIntoProfile({ ...input, fileBuffer: Buffer.from("%PDF-1.7\ncorrupt"), allowAi: true }), { code: "INVALID" });
  await assert.rejects(ingestResumeIntoProfile({ ...input, fileBuffer: pdfFixture({ encrypted: true }), allowAi: true }), { code: "ENCRYPTED" });
  await assert.rejects(ingestResumeIntoProfile({ ...input, fileBuffer: pdfFixture({ pages: 21 }), allowAi: true }), { code: "PAGE_LIMIT" });
  await assert.rejects(ingestResumeIntoProfile({ ...input, fileBuffer: pdfFixture({ text: "" }), allowAi: false }), /scanned or image-based/);
  assert.equal(requests, 0, "rejected files must never fall through to AI upload");
  const result = await ingestResumeIntoProfile({ ...input, fileBuffer: pdfFixture(), allowAi: false });
  assert.equal(result.extractionMode, "heuristic");
  assert.match(result.extractedText, /taylor@example.com/);
  assert.equal(result.mergedProfile.contact.fullName, "Preserved Name");
  assert.equal(existingProfile.contact.email, "", "the original profile object is unchanged");
  console.log("Ingestion boundary: rejected files do not reach AI, existing profile is preserved, local import works");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
