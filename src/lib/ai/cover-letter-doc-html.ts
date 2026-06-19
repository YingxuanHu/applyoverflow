export const COVER_LETTER_WORD_MIME_TYPE = "application/msword; charset=utf-8";

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
