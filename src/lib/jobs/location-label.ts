// Reject obvious prose fragments, not unfamiliar towns or employer office names.
export function isJobLocationProse(value: string) {
  return /^(?:(?:the|our|this)\s+(?:(?:senior|junior|lead)\s+)?(?:paralegal|engineer|developer|analyst|manager|candidate|applicant|employee|incumbent|position|role)(?:\s|$)|(?:you|we)\s+(?:will|are|must|should)\b)/i.test(
    value.trim(),
  );
}
