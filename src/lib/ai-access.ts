/**
 * AI access is available to every authenticated account. Individual API routes
 * still enforce their per-user rate limits and require OPENAI_API_KEY.
 */
export function isAiFeatureAllowed(email: string | null | undefined) {
  return Boolean(email?.trim());
}
