export function optionalCookieDeclineLabel(text, labels) {
  if (!/\bcookies?\b/i.test(text || "")) return null;
  const matches = labels.map(label => label.trim().replace(/\s+/g, " "))
    .filter(label => /^(?:decline|reject) (?:all(?: optional)?(?: cookies)?|optional cookies)$/i.test(label));
  return matches.length === 1 ? matches[0] : null;
}
