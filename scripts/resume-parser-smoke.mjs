import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { docxFixture, imageFixture, pdfFixture, resumeText } from "./resume-parser-fixtures.mjs";
import { legacyDocFixture } from "../tests/fixtures/legacy-resume-doc.mjs";

const isolated = process.argv.includes("--isolated");
const source = process.cwd();
const root = await realpath(isolated ? await mkdtemp(resolve(tmpdir(), "resume-parser-standalone-")) : resolve(process.argv[2] ?? source));
try {
  if (isolated) {
    const { traceResumeParserFiles } = await import("./resume-parser/trace.mjs");
    for (const file of await traceResumeParserFiles(source)) {
      assert.ok(!file.split("/").includes(".."), "tracing must stay inside the application");
      const destination = resolve(root, file);
      await mkdir(dirname(destination), { recursive: true });
      await cp(resolve(source, file), destination, { dereference: true });
    }
  }
  const require = createRequire(pathToFileURL(resolve(root, "package.json")));
  for (const dependency of ["pdf-parse", "pdfjs-dist/legacy/build/pdf.worker.mjs", "mammoth", "word-extractor", "@napi-rs/canvas"]) {
    assert.ok(require.resolve(dependency).startsWith(`${root}${sep}node_modules${sep}`), `${dependency} must be inside the runtime`);
  }
  const { parseResume } = require(resolve(root, "scripts/resume-parser/runtime.cjs"));
  const parse = (bytes, name, options = {}) => parseResume(bytes, name, "", { runtimeRoot: root, ...options });
  assert.match((await parse(Buffer.from(resumeText), "resume.txt")).text, /Taylor Applicant/);
  assert.match((await parse(await docxFixture(), "resume.docx")).text, /Taylor Applicant/);
  assert.match((await parse(legacyDocFixture(), "resume.doc")).text, /This is a test for parsing/);
  const pdf = await parse(pdfFixture(), "resume.pdf", { preview: true });
  assert.match(pdf.text, /Taylor Applicant/);
  assert.equal(pdf.previews.length, 1);
  const { loadImage, createCanvas } = require("@napi-rs/canvas");
  const preview = await loadImage(pdf.previews[0]);
  const canvas = createCanvas(preview.width, preview.height);
  const context = canvas.getContext("2d");
  context.drawImage(preview, 0, 0);
  const pixels = context.getImageData(0, 0, preview.width, preview.height).data;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0 && pixels[i] + pixels[i + 1] + pixels[i + 2] < 600) ink++;
  assert.ok(ink > 100, "PDF preview must have visible content");
  assert.equal((await parse(imageFixture(), "resume.png")).kind, "png");
  await assert.rejects(parse(pdfFixture({ encrypted: true }), "locked.pdf"), { code: "ENCRYPTED" });
  console.log(`Bounded resume parser ${isolated ? "relocated standalone" : "packaged runtime"}: text, DOC, DOCX, PDF text/visible preview, image and encrypted rejection passed`);
} finally {
  if (isolated) await rm(root, { recursive: true, force: true });
}
