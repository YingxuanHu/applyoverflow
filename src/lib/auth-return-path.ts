const INTERNAL_ORIGIN = "https://applyoverflow.local";

export function getSafeSignInCallback(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  ) return "/jobs";

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    // A signed-in visit to the sign-in page must not redirect back to itself.
    if (url.origin !== INTERNAL_ORIGIN || /^\/sign-in\/?$/.test(url.pathname)) return "/jobs";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/jobs";
  }
}
