import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = resolve(process.argv[2] ?? process.cwd());
const runtimeRequire = createRequire(pathToFileURL(resolve(runtimeRoot, "package.json")));

// Do not let a local checkout's parent node_modules mask missing runtime files.
assert.ok(
  runtimeRequire.resolve("@napi-rs/canvas").startsWith(`${runtimeRoot}${sep}node_modules${sep}`),
  "@napi-rs/canvas must be included in the packaged runtime",
);
const parserRoot = resolve(runtimeRoot, "node_modules/pdf-parse");
const parserPackage = JSON.parse(readFileSync(resolve(parserRoot, "package.json"), "utf8"));
const parserEntry = resolve(parserRoot, parserPackage.exports["."].import.default);
const { PDFParse } = await import(pathToFileURL(parserEntry).href);

const text = "Taylor Applicant - taylor@example.com - Toronto - Software Engineer";
const stream = `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let source = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(source));
  source += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(source);
source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const parser = new PDFParse({ data: Buffer.from(source) });
try {
  const result = await parser.getText();
  assert.ok(result.text.includes(text), "uploaded PDF text must be readable");
  const preview = await parser.getScreenshot({ first: 1, imageBuffer: false, imageDataUrl: true, scale: 1 });
  assert.equal(preview.pages.length, 1);
  assert.match(preview.pages[0].dataUrl, /^data:image\/png;base64,/);
  const { createCanvas, loadImage } = runtimeRequire("@napi-rs/canvas");
  const image = await loadImage(preview.pages[0].dataUrl);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let inkPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] > 0 && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 600) inkPixels++;
  }
  assert.ok(inkPixels > 100, "PDF preview must contain visible text");
  console.log("Packaged PDF parser: text extraction and image preview passed");
} finally {
  await parser.destroy();
}
