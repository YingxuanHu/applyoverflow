import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { parseResume, LIMITS } from "../scripts/resume-parser/runtime.cjs";
import { docxFixture, imageFixture, pdfFixture, resumeText } from "../scripts/resume-parser-fixtures.mjs";
import { legacyDocFixture } from "./fixtures/legacy-resume-doc.mjs";

const probe = resolve("tests/fixtures/resume-parser-probe.cjs");
const parse = (bytes: Buffer, name: string, options = {}) => parseResume(bytes, name, "", options);
const fails = (promise: Promise<unknown>, code: string) => assert.rejects(promise, { name: "ResumeParserError", code });

test("supported small text, RTF, DOCX, PDF and images use the real isolated parsers", async () => {
  assert.equal(createHash("sha256").update(legacyDocFixture()).digest("hex"), "69518782e37ac2d38a519857abae4bf7b5f10320fb7be3176bcd7751643d480e");
  assert.match((await parse(Buffer.from(resumeText), "resume.txt")).text, /Taylor Applicant/);
  assert.match((await parse(Buffer.from(`{\\rtf1 ${resumeText}\\par Skills}`), "resume.rtf")).text, /Taylor Applicant/);
  assert.match((await parse(await docxFixture(), "resume.docx")).text, /Taylor Applicant/);
  assert.match((await parse(legacyDocFixture(), "resume.doc")).text, /This is a test for parsing the Word file in node/);
  const pdf = await parse(pdfFixture(), "resume.pdf", { preview: true });
  assert.match(pdf.text, /Taylor Applicant/);
  assert.equal(pdf.pages, 1);
  assert.equal(pdf.previews.length, 1);
  assert.match(pdf.previews[0], /^data:image\/png;base64,/);
  for (const format of ["png", "jpeg", "webp"]) {
    assert.equal((await parse(imageFixture(format), `resume.${format}`)).text, "");
  }
});

test("signatures, MIME conflicts, corrupt documents and invalid UTF-8 fail closed", async () => {
  for (const extension of ["pdf", "doc", "docx", "rtf", "png", "jpg", "webp"]) {
    await fails(parse(Buffer.from("not that format"), `resume.${extension}`), "INVALID");
  }
  await fails(parseResume(pdfFixture(), "resume.pdf", "image/png"), "INVALID");
  await fails(parse(Buffer.from("%PDF-1.7\ncorrupt"), "resume.pdf"), "INVALID");
  await fails(parse(Buffer.from("504b03040000000000", "hex"), "resume.docx"), "INVALID");
  await fails(parse(Buffer.from([0xff, 0xfe, 0xfd]), "resume.txt"), "INVALID");
  await fails(parse(Buffer.from("{\\rtf1 unfinished"), "resume.rtf"), "INVALID");
});

test("empty and oversized input and extracted output are rejected", async () => {
  await fails(parse(Buffer.alloc(0), "resume.txt"), "INPUT_LIMIT");
  await fails(parse(Buffer.alloc(LIMITS.inputBytes + 1), "resume.txt"), "INPUT_LIMIT");
  await fails(parse(Buffer.alloc(LIMITS.textBytes + 1, "A"), "resume.txt"), "OUTPUT_LIMIT");
});

test("encrypted PDF and Office containers report an actionable error", async () => {
  await fails(parse(pdfFixture({ encrypted: true }), "resume.pdf"), "ENCRYPTED");
  await fails(parse(Buffer.from("d0cf11e0a1b11ae10000", "hex"), "resume.docx"), "ENCRYPTED");
  const zip = await docxFixture();
  for (let i = 0; i < zip.length - 10; i++) {
    if (zip.readUInt32LE(i) === 0x04034b50) zip.writeUInt16LE(zip.readUInt16LE(i + 6) | 1, i + 6);
    if (zip.readUInt32LE(i) === 0x02014b50) zip.writeUInt16LE(zip.readUInt16LE(i + 8) | 1, i + 8);
  }
  await fails(parse(zip, "resume.docx"), "ENCRYPTED");
});

test("DOCX expansion, entry count, XML entities and embedded active documents are bounded", async () => {
  await fails(parse(await docxFixture({ "word/bomb.xml": "x".repeat(LIMITS.archiveEntryBytes + 1) }), "resume.docx"), "ARCHIVE_LIMIT");
  await fails(parse(await docxFixture({ "word/ratio.xml": "x".repeat(100_000) }), "resume.docx"), "ARCHIVE_LIMIT");
  const entries = Object.fromEntries(Array.from({ length: LIMITS.archiveEntries + 1 }, (_, i) => [`word/file${i}.xml`, "x"]));
  await fails(parse(await docxFixture(entries), "resume.docx"), "ARCHIVE_LIMIT");
  await fails(parse(await docxFixture({ "word/document.xml": '<!DOCTYPE x [<!ENTITY x "boom">]><x>&x;</x>' }), "resume.docx"), "UNSUPPORTED");
  await fails(parse(await docxFixture({ "word/embeddings/object.bin": "x" }), "resume.docx"), "UNSUPPORTED");
});

test("archive actual sizes, CRCs and cumulative expansion are checked before Mammoth", async () => {
  const lied = await docxFixture({ "word/extra.bin": "A".repeat(4000) });
  for (let i = 0; i < lied.length - 46; i++) {
    if (lied.readUInt32LE(i) === 0x02014b50 && lied.readUInt32LE(i + 24) === 4000) lied.writeUInt32LE(10, i + 24);
  }
  await fails(parse(lied, "resume.docx"), "INVALID");
  const badCrc = await docxFixture();
  const directory = badCrc.indexOf(Buffer.from("504b0102", "hex"));
  badCrc.writeUInt32LE((badCrc.readUInt32LE(directory + 16) ^ 1) >>> 0, directory + 16);
  await fails(parse(badCrc, "resume.docx"), "INVALID");
  const repeated = Buffer.concat(Array(200).fill(randomBytes(16 * 1024)));
  const extra = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`word/extra${i}.bin`, repeated]));
  await fails(parse(await docxFixture(extra), "resume.docx"), "ARCHIVE_LIMIT");
});

test("PDF page, scanned-preview and image dimension limits do not silently truncate", async () => {
  await fails(parse(pdfFixture({ pages: LIMITS.pages + 1 }), "resume.pdf"), "PAGE_LIMIT");
  const scanned = await parse(pdfFixture({ text: "" }), "scan.pdf", { preview: true });
  assert.equal(scanned.text.trim(), "");
  assert.equal(scanned.previews.length, 1);
  await fails(parse(pdfFixture({ text: "", pages: 3 }), "scan.pdf", { preview: true }), "UNSUPPORTED");
  await fails(parse(pdfFixture({ text: "", width: 100000 }), "scan.pdf", { preview: true }), "IMAGE_LIMIT");
  const png = imageFixture();
  png.writeUInt32BE(100000, 16);
  await fails(parse(png, "resume.png"), "IMAGE_LIMIT");
});

test("hard deadline kills a synchronous loop without blocking the parent and releases the slot", async () => {
  let ticked = false;
  const timer = setTimeout(() => { ticked = true; }, 20);
  await fails(parse(Buffer.from("spin"), "resume.txt", { workerPath: probe, deadlineMs: 150 }), "TIMEOUT");
  clearTimeout(timer);
  assert.equal(ticked, true);
  assert.equal((await parse(Buffer.from("recovered"), "resume.txt")).text, "recovered");
});

test("RSS budget covers external Buffers, heap exhaustion and excessive output are contained", async () => {
  await fails(parse(Buffer.from("rss"), "resume.txt", { workerPath: probe, rssBytes: 96 * 1024 * 1024 }), "MEMORY_LIMIT");
  await fails(parse(Buffer.from("heap"), "resume.txt", { workerPath: probe }), "MEMORY_LIMIT");
  await fails(parse(Buffer.from("flood"), "resume.txt", { workerPath: probe }), "OUTPUT_LIMIT");
  await fails(parse(Buffer.from("crash"), "resume.txt", { workerPath: probe }), "UNAVAILABLE");
});

test("concurrency has no unbounded queue and cancellation reaps children", async () => {
  const controller = new AbortController();
  const jobs = Array.from({ length: LIMITS.concurrency }, () =>
    fails(parse(Buffer.from("spin"), "resume.txt", { workerPath: probe, signal: controller.signal }), "CANCELLED"));
  await assert.rejects(parse(Buffer.from("third"), "resume.txt"), { code: "BUSY", status: 503, retryable: true });
  controller.abort();
  await Promise.all(jobs);
  await fails(parse(Buffer.from("aborted"), "resume.txt", { signal: controller.signal }), "CANCELLED");
  assert.equal((await parse(Buffer.from("recovered"), "resume.txt")).text, "recovered");
});

test("child receives no inherited credentials or preload flags and cannot read app files/write/spawn", async () => {
  const previous = { NODE_OPTIONS: process.env.NODE_OPTIONS, DATABASE_URL: process.env.DATABASE_URL, UV_USE_IO_URING: process.env.UV_USE_IO_URING };
  process.env.NODE_OPTIONS = "--require=/must-not-load.cjs";
  process.env.DATABASE_URL = "sentinel-must-not-leak";
  process.env.UV_USE_IO_URING = "sentinel-must-not-leak";
  try {
    const result = JSON.parse((await parse(Buffer.from("probe"), "resume.txt", { workerPath: probe })).text);
    // These runtime-owned values can appear even when launched with an empty env.
    assert.ok(result.ioUring === undefined || (process.platform === "linux" && result.ioUring === "0"));
    const runtimeKeys = process.platform === "linux" ? ["UV_USE_IO_URING"] : process.platform === "darwin" ? ["__CF_USER_TEXT_ENCODING"] : [];
    assert.deepEqual(result.envKeys.filter((key: string) => !runtimeKeys.includes(key)), ["LANG", "NODE_ENV", "TZ", "UV_THREADPOOL_SIZE"]);
    assert.equal(result.readDenied, true);
    assert.equal(result.writeDenied, true);
    assert.equal(result.childDenied, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
