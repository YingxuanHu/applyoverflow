import { z } from "zod";
import { normalizeJobsStateQuery } from "@/lib/jobs/search-state";

export const SAVED_SEARCH_PREFIX = "named-search-v1:";
export const savedSearchSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    query: z.string().max(4096),
    reviewedAt: z.string().datetime(),
  })
  .strict();
export type SavedSearch = z.infer<typeof savedSearchSchema> & { id: string };
export function cleanSavedQuery(query: string) {
  const params = new URLSearchParams(query);
  params.delete("discoveredSince");
  return normalizeJobsStateQuery(params, { includePage: false });
}
export function savedSearchHref(search: SavedSearch, newOnly = false) {
  const params = new URLSearchParams(search.query);
  if (newOnly) params.set("discoveredSince", search.reviewedAt);
  // Explicit marker prevents the browser's implicit filter memory overriding
  // a saved search that intentionally covers the whole board.
  params.set("savedSearch", search.id);
  return `/jobs?${params}`;
}
export { parseDiscoveredSince } from "@/lib/jobs/search-params";
