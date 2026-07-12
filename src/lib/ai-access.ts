/**
 * Account eligibility is not an AI feature gate. Callers must still authenticate,
 * enforce their per-user limits, and verify that the AI service is configured.
 *
 * The optional argument remains for compatibility with callers that previously
 * passed a user's email.
 */
export function isAiFeatureAllowed(_email?: string | null) {
  return true;
}
