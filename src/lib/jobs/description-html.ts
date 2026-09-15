import { Parser } from "htmlparser2";

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "blockquote", "ul", "ol", "dl", "dt", "dd", "table", "tr", "pre"]);
const OMIT_TAGS = new Set(["script", "style", "noscript", "template", "iframe", "svg", "nav"]);

/** Convert source markup to inert text without flattening its document structure. */
export function descriptionHtmlToText(source: string): string {
  if (!source.trim()) return "";
  const hasMarkup = /<\/?(?:html|body|nav|p|div|section|article|h[1-6]|br|li|ul|ol|dl|dt|dd|span|strong|b|em|a|table|tr|td|script|style|blockquote|pre)\b[^>]*>/i.test(source);
  let output = "";
  let omitted = 0;
  let boldStart: number | null = null;
  let pendingBold: { start: number; end: number } | null = null;
  const lists: Array<{ ordered: boolean; next: number }> = [];
  const finishBoldHeading = () => {
    if (pendingBold && !output.slice(pendingBold.end).trim()) {
      const heading = output.slice(pendingBold.start, pendingBold.end).trim();
      if (heading && heading.length <= 160) output = `${output.slice(0, pendingBold.start)}## ${heading}`;
    }
    pendingBold = null;
  };
  const lineBreak = () => { finishBoldHeading(); output = `${output.trimEnd()}\n\n`; };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (OMIT_TAGS.has(name)) omitted += 1;
      if (omitted) return;
      if ((name === "strong" || name === "b") && !output.slice(output.lastIndexOf("\n") + 1).trim()) boldStart = output.length;
      if (name === "ul" || name === "ol") {
        const start = Number.parseInt(attributes.start ?? "1", 10);
        lists.push({ ordered: name === "ol", next: Number.isFinite(start) ? start : 1 });
      }
      if (/^h[1-6]$/.test(name)) {
        lineBreak();
        output += "## ";
      } else if (name === "li") {
        lineBreak();
        const list = lists.at(-1);
        const value = Number.parseInt(attributes.value ?? "", 10);
        if (list && Number.isFinite(value)) list.next = value;
        output += list?.ordered ? `${list.next++}. ` : "- ";
      } else if (name === "br") {
        output += "\n";
      } else if (BLOCK_TAGS.has(name) && !/(?:^|\n)(?:- |\d+\. )$/.test(output)) {
        lineBreak();
      } else if ((name === "td" || name === "th") && output.trim() && !output.endsWith("\n\n")) {
        output += " | ";
      }
    },
    ontext(text) {
      if (omitted) return;
      if (pendingBold && text.trim()) pendingBold = null;
      output += hasMarkup ? text.replace(/\s+/g, " ") : text;
    },
    onclosetag(name) {
      if (OMIT_TAGS.has(name)) { omitted = Math.max(0, omitted - 1); return; }
      if (omitted) return;
      if ((name === "strong" || name === "b") && boldStart !== null) {
        pendingBold = { start: boldStart, end: output.length };
        boldStart = null;
      }
      if (name === "ul" || name === "ol") lists.pop();
      if (BLOCK_TAGS.has(name) || /^h[1-6]$/.test(name) || name === "li") lineBreak();
    },
  }, { decodeEntities: true });
  // Plain text may contain comparisons or type parameters, not HTML tags.
  parser.end(hasMarkup ? source : source.replace(/</g, "&lt;"));
  finishBoldHeading();
  return output.replace(/\r/g, "").split("\n")
    .map((line) => line.replace(/[\t \u00a0]+/g, " ").trim())
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
