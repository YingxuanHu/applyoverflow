export function splitFilterValues(value?: string | null) {
  if (!value) return [];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const entry of value.split(",")) {
    const trimmed = entry.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(trimmed);
  }

  return values;
}

export function normalizeFilterValueList(value?: string | null) {
  const values = splitFilterValues(value);
  return values.length > 0 ? values.join(",") : undefined;
}

/** Trim a free-text search/query param and cap its length; undefined when empty. */
export function normalizeTextParam(value?: string) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}
