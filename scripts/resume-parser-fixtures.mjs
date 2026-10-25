import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const resumeText = "Taylor Applicant - taylor@example.com - Toronto - Software Engineer";

export function pdfFixture({ pages = 1, text = resumeText, width = 600, height = 160, encrypted = false } = {}) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let page = 0; page < pages; page++) {
    const pageId = objects.length + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    const stream = text ? `BT /F1 12 Tf 40 100 Td (${text}) Tj ET` : "0 0 0 rg 40 40 80 40 re f";
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${"01".repeat(32)}> /U <${"02".repeat(32)}> /P -4 >>`);
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

export async function docxFixture(extra = {}, compression = "DEFLATE") {
  const JSZip = createRequire(require.resolve("mammoth"))("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${resumeText}</w:t></w:r></w:p></w:body></w:document>`);
  for (const [name, value] of Object.entries(extra)) zip.file(name, value);
  return zip.generateAsync({ type: "nodebuffer", compression });
}

export function imageFixture(format = "png") {
  const { createCanvas } = require("@napi-rs/canvas");
  const canvas = createCanvas(300, 120);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 300, 120);
  context.fillStyle = "black";
  context.fillRect(20, 20, 100, 20);
  return canvas.toBuffer(`image/${format}`);
}
