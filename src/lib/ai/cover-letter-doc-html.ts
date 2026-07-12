export const COVER_LETTER_WORD_MIME_TYPE = "application/msword; charset=utf-8";
export const COVER_LETTER_DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const COVER_LETTER_PDF_MIME_TYPE = "application/pdf";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderParagraph(block: string) {
  const lines = block
    .split(/\n+/)
    .map((line) => escapeHtml(line.trim()))
    .filter(Boolean);

  return lines.length > 0 ? `<p>${lines.join("<br>")}</p>` : "";
}

export function buildCoverLetterDocHtml(text: string) {
  const body = text
    .trim()
    .split(/\n{2,}/)
    .map(renderParagraph)
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Cover Letter</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
    p { margin: 0 0 12pt; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export function buildCoverLetterDocFileName(title: string) {
  const safeTitle = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${safeTitle || "cover-letter"}.doc`;
}

export function buildCoverLetterDocxFileName(title: string) {
  const safeTitle = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${safeTitle || "cover-letter"}.docx`;
}

export function buildCoverLetterPdfFileName(title: string) {
  const safeTitle = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${safeTitle || "cover-letter"}.pdf`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderWordParagraph(block: string) {
  const lines = block
    .split(/\n+/)
    .map((line) => escapeXml(line.trim()))
    .filter(Boolean);

  if (lines.length === 0) return "";

  const runs = lines
    .map((line, index) =>
      index === 0
        ? `<w:r><w:t xml:space="preserve">${line}</w:t></w:r>`
        : `<w:r><w:br/><w:t xml:space="preserve">${line}</w:t></w:r>`
    )
    .join("");

  return `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>${runs}</w:p>`;
}

function buildWordDocumentXml(text: string) {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map(renderWordParagraph)
    .filter(Boolean)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

const textEncoder = new TextEncoder();

function encodeUtf8(value: string) {
  return textEncoder.encode(value);
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>) {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeUtf8(file.name);
    const crc = crc32(file.data);

    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, file.data.byteLength);
    writeUint32(localView, 22, file.data.byteLength);
    writeUint16(localView, 26, name.byteLength);
    local.set(name, 30);
    localChunks.push(local, file.data);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, file.data.byteLength);
    writeUint32(centralView, 24, file.data.byteLength);
    writeUint16(centralView, 28, name.byteLength);
    writeUint32(centralView, 42, offset);
    central.set(name, 46);
    centralChunks.push(central);

    offset += local.byteLength + file.data.byteLength;
  }

  const centralDirectory = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectory.byteLength);
  writeUint32(endView, 16, offset);

  return concatBytes([...localChunks, centralDirectory, end]);
}

export function buildCoverLetterDocxBytes(text: string) {
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    },
    {
      name: "word/document.xml",
      data: encodeUtf8(buildWordDocumentXml(text)),
    },
  ]);
}

function escapePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapPdfLine(line: string, maxChars = 92) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function buildPdfLines(text: string) {
  const lines: string[] = [];
  for (const block of text.trim().split(/\n{2,}/)) {
    for (const line of block.split(/\n+/)) {
      lines.push(...wrapPdfLine(line));
    }
    lines.push("");
  }
  return lines;
}

function buildPdfContent(lines: string[]) {
  const commands = ["BT", "/F1 11 Tf", "14 TL", "72 740 Td"];
  for (const line of lines) {
    if (line) commands.push(`(${escapePdfText(line)}) Tj`);
    commands.push("T*");
  }
  commands.push("ET");
  return commands.join("\n");
}

export function buildCoverLetterPdfBytes(text: string) {
  const allLines = buildPdfLines(text);
  const pages: string[][] = [];
  for (let index = 0; index < allLines.length; index += 45) {
    pages.push(allLines.slice(index, index + 45));
  }
  if (pages.length === 0) pages.push([""]);

  const objects = new Array<string>();
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((pageLines, index) => {
    const pageObjectId = pageObjectIds[index]!;
    const contentObjectId = pageObjectId + 1;
    const content = buildPdfContent(pageLines);
    objects[pageObjectId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(chunks.join("").length);
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = chunks.join("").length;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return encodeUtf8(chunks.join(""));
}
