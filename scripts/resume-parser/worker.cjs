"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Plain Node child, with CJS-only parser APIs and no application loader. */

const { createRequire } = require("node:module");
const { crc32 } = require("node:zlib");
const { LIMITS, ResumeParserError, fail, validateInput } = require("./policy.cjs");

// stdout is a bounded protocol, never parser diagnostics or document content logs.
console.log = console.warn = console.error = console.info = console.debug = () => {};

function checkText(text) {
  if (Buffer.byteLength(text) > LIMITS.textBytes) fail("OUTPUT_LIMIT");
  return text;
}

function checkDimensions(width, height, pixels = LIMITS.imagePixels) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      width > LIMITS.imageDimension || height > LIMITS.imageDimension || width * height > pixels) fail("IMAGE_LIMIT");
}

async function docxText(buffer) {
  // Resolve the existing extractor's ZIP reader, not an undeclared new package.
  const yauzl = createRequire(require.resolve("word-extractor"))("yauzl");
  const files = new Map();
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      let expanded = 0;
      let declared = 0;
      let entries = 0;
      const abort = (err) => { zip.close(); reject(err); };
      zip.on("error", abort);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        try {
          entries++;
          declared += entry.uncompressedSize;
          if (entries > LIMITS.archiveEntries || entry.uncompressedSize > LIMITS.archiveEntryBytes ||
              declared > LIMITS.archiveBytes || entry.uncompressedSize > Math.max(1, entry.compressedSize) * LIMITS.compressionRatio) fail("ARCHIVE_LIMIT");
          if (entry.generalPurposeBitFlag & 1) fail("ENCRYPTED");
          if (![0, 8].includes(entry.compressionMethod)) fail("UNSUPPORTED");
          const name = entry.fileName;
          if (files.has(name) || name.includes("\0") || name.split("/").some((part) => part === "..") ||
              ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) fail("INVALID");
          if (/vbaProject\.bin$|^word\/embeddings\//i.test(name)) fail("UNSUPPORTED");
          files.set(name, Buffer.alloc(0));
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) return abort(streamError);
            let size = 0;
            const chunks = [];
            stream.on("error", abort);
            stream.on("data", (chunk) => {
              size += chunk.length;
              expanded += chunk.length;
              if (size > LIMITS.archiveEntryBytes || expanded > LIMITS.archiveBytes || size > entry.uncompressedSize) {
                stream.destroy();
                abort(new ResumeParserError("ARCHIVE_LIMIT"));
              } else chunks.push(chunk);
            });
            stream.on("end", () => {
              const content = Buffer.concat(chunks);
              if (content.length !== entry.uncompressedSize || crc32(content) !== entry.crc32) {
                return abort(new ResumeParserError("INVALID"));
              }
              if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(content.toString("utf8"))) {
                return abort(new ResumeParserError("UNSUPPORTED"));
              }
              files.set(name, content);
              zip.readEntry();
            });
          });
        } catch (err) { abort(err); }
      });
      zip.readEntry();
    });
  });
  if (!files.has("[Content_Types].xml") || !files.has("word/document.xml")) fail("INVALID");
  // Feed only the checked, already-expanded members to Mammoth. It must not
  // reopen the ZIP with a second parser or fetch external relationship targets.
  const result = await require("mammoth").extractRawText({ file: {
    exists: (name) => files.has(name),
    read: (name, encoding) => {
      const content = files.get(name);
      if (!content) return Promise.reject(new ResumeParserError("INVALID"));
      return Promise.resolve(encoding ? content.toString(encoding) : content);
    },
  } }, { externalFileAccess: false });
  if (result.messages.some((message) => message.type === "error")) fail("INVALID");
  return checkText(result.value);
}

async function docText(buffer) {
  if (buffer.length < 512 || buffer.readUInt16LE(28) !== 0xfffe ||
      ![9, 12].includes(buffer.readUInt16LE(30)) || buffer.readUInt16LE(32) !== 6) fail("INVALID");
  const sectors = Math.ceil(buffer.length / (2 ** buffer.readUInt16LE(30)));
  for (const offset of [44, 64, 72]) if (buffer.readUInt32LE(offset) > sectors) fail("INVALID");
  const WordOleExtractor = require("word-extractor/lib/word-ole-extractor");
  const BufferReader = require("word-extractor/lib/buffer-reader");
  class BoundedWordExtractor extends WordOleExtractor {
    async streamBuffer(stream) {
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > LIMITS.archiveBytes) fail("ARCHIVE_LIMIT");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }
    extractWordDocument(document, wordBuffer) {
      if (wordBuffer.length < 12) fail("INVALID");
      // MS-DOC FibBase fEncrypted / fObfuscated, before reading the piece table.
      if (wordBuffer.readUInt16LE(10) & 0x8100) fail("ENCRYPTED");
      return super.extractWordDocument(document, wordBuffer);
    }
  }
  const document = await new BoundedWordExtractor().extract(new BufferReader(buffer));
  return checkText(document.getBody());
}

function imageDimensions(buffer, kind) {
  if (kind === "png") {
    if (buffer.length < 33 || buffer.toString("ascii", 12, 16) !== "IHDR") fail("INVALID");
    let ended = false;
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      if (offset + length + 12 > buffer.length) fail("INVALID");
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL") fail("UNSUPPORTED");
      if (type === "IEND") { ended = true; break; }
      offset += length + 12;
    }
    if (!ended) fail("INVALID");
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  }
  if (kind === "jpg" || kind === "jpeg") {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset++] !== 0xff) fail("INVALID");
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = buffer.readUInt16BE(offset);
      if (size < 2 || offset + size > buffer.length) fail("INVALID");
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
      offset += size;
    }
    fail("UNSUPPORTED");
  }
  if (buffer.length < 30 || buffer.readUInt32LE(4) + 8 !== buffer.length) fail("INVALID");
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    if (buffer[20] & 0x02) fail("UNSUPPORTED"); // Animated resumes are not supported.
    return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
  }
  if (chunk === "VP8 " && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
  }
  if (chunk === "VP8L" && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  fail("UNSUPPORTED");
}

async function pdfContent(buffer, preview) {
  const { createCanvas } = require("@napi-rs/canvas");
  class BoundedCanvasFactory {
    create(width, height) {
      checkDimensions(width, height, LIMITS.canvasPixels);
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
      return { canvas, context: canvas.getContext("2d") };
    }
    reset(target, width, height) {
      checkDimensions(width, height, LIMITS.canvasPixels);
      target.canvas.width = Math.ceil(width);
      target.canvas.height = Math.ceil(height);
    }
    destroy(target) { target.canvas.width = 0; target.canvas.height = 0; target.canvas = null; target.context = null; }
  }
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"));
  const parser = new PDFParse({ data: buffer, isEvalSupported: false, useWasm: false,
    stopAtErrors: true, maxImageSize: LIMITS.imagePixels, CanvasFactory: BoundedCanvasFactory });
  try {
    const info = await parser.getInfo();
    if (!Number.isInteger(info.total) || info.total < 1) fail("INVALID");
    if (info.total > LIMITS.pages) fail("PAGE_LIMIT");
    let text = "";
    for (let page = 1; page <= info.total; page++) {
      const result = await parser.getText({ partial: [page], pageJoiner: "" });
      text = checkText(text + result.pages.map((entry) => entry.text).join("\n") + "\n");
    }
    const previews = [];
    if (preview && text.trim().length < 280) {
      // Never pretend the first two scanned pages represent a longer document.
      if (info.total > LIMITS.previewPages) fail("UNSUPPORTED");
      const pages = await parser.getInfo({ parsePageInfo: true });
      for (const page of pages.pages) {
        checkDimensions(page.width, page.height);
        const scale = Math.min(1.8, 1600 / Math.max(page.width, page.height));
        const result = await parser.getScreenshot({ partial: [page.pageNumber], imageBuffer: false, imageDataUrl: true, scale });
        previews.push(...result.pages.map((entry) => entry.dataUrl));
        if (Buffer.byteLength(JSON.stringify(previews)) > LIMITS.outputBytes - LIMITS.textBytes - 1024) fail("OUTPUT_LIMIT");
      }
    }
    return { text, previews, pages: info.total };
  } finally { await parser.destroy(); }
}

async function parse(buffer, kind, preview) {
  validateInput(buffer, `resume.${kind}`);
  if (kind === "pdf") return pdfContent(buffer, preview);
  let text = "";
  if (kind === "docx") text = await docxText(buffer);
  else if (kind === "doc") text = await docText(buffer);
  else if (kind === "txt") {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) fail("INVALID");
  } else if (kind === "rtf") {
    const rtf = buffer.toString("utf8");
    if (!rtf.trimEnd().endsWith("}")) fail("INVALID");
    if (/\\(?:object|objdata)\b/i.test(rtf)) fail("UNSUPPORTED");
    text = rtf.replace(/\\par[d]?/gi, "\n").replace(/\\tab/gi, " ")
      .replace(/\\'[0-9a-f]{2}/gi, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
      .replace(/\\u-?\d+\??/gi, " ").replace(/\\[a-z]+-?\d* ?/gi, " ").replace(/[{}]/g, " ");
  } else {
    const [width, height] = imageDimensions(buffer, kind);
    checkDimensions(width, height);
    const image = await require("@napi-rs/canvas").loadImage(buffer);
    checkDimensions(image.width, image.height);
    if (image.width !== width || image.height !== height) fail("INVALID");
  }
  return { text: checkText(text), previews: [], pages: 0 };
}

async function main() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > LIMITS.inputBytes) fail("INPUT_LIMIT");
    chunks.push(chunk);
  }
  return { ok: true, ...await parse(Buffer.concat(chunks), process.argv[2], process.argv[3] === "preview") };
}

main().catch((error) => ({ ok: false, code: error instanceof ResumeParserError ? error.code :
  /Image exceeded maximum allowed size/.test(error?.message ?? "") ? "IMAGE_LIMIT" :
  /password|encrypt/i.test(error?.name ?? "") ? "ENCRYPTED" :
  ["MODULE_NOT_FOUND", "ERR_DLOPEN_FAILED", "ERR_ACCESS_DENIED"].includes(error?.code) ? "UNAVAILABLE" : "INVALID" }))
  .then((result) => {
    let output = JSON.stringify(result);
    if (Buffer.byteLength(output) > LIMITS.outputBytes) output = JSON.stringify({ ok: false, code: "OUTPUT_LIMIT" });
    process.stdout.write(output, () => process.exit(0));
  });
