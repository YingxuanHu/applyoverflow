// Company-source polling is already bounded by wall-clock and connector-family
// caps. A small residual backlog therefore often means every remaining family
// is temporarily saturated, not that the worker has useful work left to do.
// Only defer broad trusted feeds when the queued company work is large enough
// to represent real capacity pressure.
const DEFAULT_LEGACY_SOURCE_DEFER_BACKLOG_THRESHOLD = 1_000;

export type CompanySourceBacklog = {
  connectorPoll: number;
  rediscovery: number;
};

function readThreshold() {
  const parsed = Number.parseInt(
    process.env.INGEST_LEGACY_SOURCE_DEFER_BACKLOG_THRESHOLD ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LEGACY_SOURCE_DEFER_BACKLOG_THRESHOLD;
}

export function shouldDeferLegacySources(backlog: CompanySourceBacklog) {
  return backlog.connectorPoll + backlog.rediscovery >= readThreshold();
}
