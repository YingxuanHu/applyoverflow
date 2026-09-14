import type { JobUrlHealthResult } from "@/generated/prisma/client";

export const SUCCESS_HEALTH_SNIPPET_LENGTH = 240;

// Every check keeps its outcome, timing and URL evidence. A healthy check does
// not need another full page excerpt; preserve the longer diagnostic on failures.
export function healthCheckStorageSnippet(result: JobUrlHealthResult, snippet: string | null) {
  return result === "ALIVE" && snippet ? snippet.slice(0, SUCCESS_HEALTH_SNIPPET_LENGTH) : snippet;
}
