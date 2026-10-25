"use strict";

const LIMITS = Object.freeze({
  inputBytes: 10 * 1024 * 1024,
  textBytes: 256 * 1024,
  outputBytes: 8 * 1024 * 1024,
  archiveEntries: 256,
  archiveEntryBytes: 4 * 1024 * 1024,
  archiveBytes: 16 * 1024 * 1024,
  compressionRatio: 200,
  pages: 20,
  previewPages: 2,
  imagePixels: 12_000_000,
  canvasPixels: 4_000_000,
  imageDimension: 8192,
  deadlineMs: 15_000,
  heapMb: 192,
  rssBytes: 384 * 1024 * 1024,
  concurrency: 2,
});

const ERRORS = Object.freeze({
  INVALID: "This resume is corrupt or its contents do not match its file type. Export a new PDF or DOCX and retry.",
  UNSUPPORTED: "Unsupported resume format or document feature. Export a standard PDF or DOCX and retry.",
  ENCRYPTED: "Password-protected resumes cannot be imported. Upload an unencrypted copy.",
  INPUT_LIMIT: "Resume files must be nonempty and no larger than 10 MB.",
  ARCHIVE_LIMIT: "This Word document exceeds the safe archive expansion limit. Export a smaller PDF or DOCX.",
  PAGE_LIMIT: "Resumes may contain at most 20 PDF pages. Upload a shorter resume.",
  IMAGE_LIMIT: "This resume image or PDF page is too large to process safely. Export at a smaller size.",
  OUTPUT_LIMIT: "This resume contains too much text or preview data. Upload a shorter, simpler resume.",
  TIMEOUT: "Resume parsing took too long and was stopped. Retry with a smaller or re-exported document.",
  MEMORY_LIMIT: "Resume parsing exceeded its memory budget and was stopped. Retry with a simpler document.",
  BUSY: "Resume parsing is busy. Please retry shortly; your existing profile has not changed.",
  CANCELLED: "Resume parsing was cancelled. Your existing profile has not changed.",
  UNAVAILABLE: "Resume parsing is temporarily unavailable. Please retry shortly.",
});

class ResumeParserError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(ERRORS, code) ? code : "INVALID";
    super(ERRORS[safeCode]);
    this.name = "ResumeParserError";
    this.code = safeCode;
    this.retryable = ["BUSY", "TIMEOUT", "MEMORY_LIMIT", "UNAVAILABLE"].includes(safeCode);
    this.status = safeCode === "BUSY" || safeCode === "UNAVAILABLE" ? 503 : 422;
  }
}

const TYPES = Object.freeze({
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  rtf: "application/rtf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
});

function fail(code) { throw new ResumeParserError(code); }

function validateInput(buffer, fileName, mimeType = "") {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > LIMITS.inputBytes) fail("INPUT_LIMIT");
  const extension = /\.([^.]+)$/.exec(fileName.toLowerCase())?.[1];
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  const imageType = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" }[mime];
  const kind = Object.hasOwn(TYPES, extension ?? "") ? extension : imageType;
  if (!kind) fail("UNSUPPORTED");
  // Do not allow a forged image MIME type to reroute a document to the AI image path.
  if (mime && mime !== "application/octet-stream" && mime !== TYPES[kind] &&
      !(kind === "rtf" && mime === "text/rtf") &&
      !(["jpg", "jpeg"].includes(kind) && mime === "image/jpg")) fail("INVALID");
  const starts = (hex) => buffer.subarray(0, hex.length / 2).equals(Buffer.from(hex, "hex"));
  const ole = starts("d0cf11e0a1b11ae1");
  if (kind === "docx" && ole) fail("ENCRYPTED");
  const valid = {
    pdf: () => /^%PDF-\d\.\d/.test(buffer.subarray(0, 8).toString("ascii")),
    doc: () => ole,
    docx: () => starts("504b0304"),
    rtf: () => /^\{\\rtf[12]\b/.test(buffer.subarray(0, 16).toString("ascii")),
    png: () => starts("89504e470d0a1a0a"),
    jpg: () => starts("ffd8ff"),
    jpeg: () => starts("ffd8ff"),
    webp: () => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP",
    txt: () => !buffer.includes(0),
  }[kind]();
  if (!valid) fail("INVALID");
  return { kind, mimeType: TYPES[kind] };
}

module.exports = { LIMITS, ERRORS, TYPES, ResumeParserError, fail, validateInput };
