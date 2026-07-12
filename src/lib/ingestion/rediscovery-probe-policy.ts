// Rediscovery re-inspects a broken source's known career pages, which can
// never find a board that moved to a different ATS platform: careers URLs
// rot, and companies migrate platforms outright (e.g. Taleo -> Greenhouse),
// leaving nothing on the old pages to rediscover. The direct ATS slug probe
// can find the new board, so rediscovery runs it as a follow-up and feeds
// every hit through the normal candidate validation + promotion pipeline.
//
// Probing guesses slugs against external ATS endpoints, so it is reserved
// for sources that are genuinely broken: a source that landed in rediscovery
// after a transient blip must not spam the platforms with probe traffic.
export const REDISCOVERY_PROBE_MIN_CONSECUTIVE_FAILURES = 3;

export type RediscoveryProbeInput = {
  // True when the source's company has a usable name and/or domain — without
  // either there is nothing to derive slug candidates from.
  hasCompanyIdentity: boolean;
  // Carried for future connector-specific gating (e.g. skipping connectors
  // whose platform the probe cannot cover); not consulted today.
  connectorName: string;
  consecutiveFailures: number;
};

export function shouldProbeOnRediscovery(input: RediscoveryProbeInput): boolean {
  if (!input.hasCompanyIdentity) return false;
  return input.consecutiveFailures >= REDISCOVERY_PROBE_MIN_CONSECUTIVE_FAILURES;
}
