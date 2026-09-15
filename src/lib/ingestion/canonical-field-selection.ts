const STRUCTURED_SOURCES = new Set([
  "official_api",
  "ats_api",
  "json_ld",
  "connector_raw",
  "structured_location",
  "ats_location",
]);

const WEAK_TEXT_SOURCES = new Set([
  "description_text",
  "body_text",
  "remote_text",
  "html_location",
  "url",
  "url_slug",
  "h1",
  "meta_title",
  "og_title",
  "link_text",
  "fallback",
]);

export function shouldUseIncomingExtractedValue(input: {
  preferIncomingSource: boolean;
  currentConfidence: number | null;
  currentSource: string | null;
  nextConfidence: number | null;
  nextSource: string | null;
  nextValueIsKnown: boolean;
}) {
  if (!input.nextValueIsKnown || input.nextConfidence == null) return false;
  const nextIsStructured = input.nextSource != null && STRUCTURED_SOURCES.has(input.nextSource);
  const currentIsWeak = input.currentSource == null || WEAK_TEXT_SOURCES.has(input.currentSource);
  const currentIsStructured = input.currentSource != null && STRUCTURED_SOURCES.has(input.currentSource);
  const nextIsWeak = input.nextSource == null || WEAK_TEXT_SOURCES.has(input.nextSource);

  // Source priority must not undo a field repaired from stronger evidence.
  if (currentIsStructured && nextIsWeak && input.currentConfidence != null &&
      input.currentConfidence >= 0.78 && input.nextConfidence < input.currentConfidence) return false;
  if (input.preferIncomingSource || input.currentConfidence == null) return true;

  return nextIsStructured && currentIsWeak && input.nextConfidence >= 0.78 &&
    input.nextConfidence >= input.currentConfidence + 0.15;
}
