/**
 * Inactive canonical jobs are retained briefly to absorb transient source
 * failures and preserve the dedupe/freshness boundary. They are never
 * eligible for the public feed during that grace period.
 */
export const INACTIVE_JOB_RETENTION_DAYS = 14;

export const INACTIVE_JOB_STATUSES = ["EXPIRED", "REMOVED"] as const;

export function isInactiveJobStatus(status: string) {
  return (INACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}
