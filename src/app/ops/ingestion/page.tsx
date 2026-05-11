import Link from "next/link";
import { connection } from "next/server";
import { formatDisplayLabel, formatRelativeAge } from "@/lib/job-display";
import { getDeploymentTopology } from "@/lib/deployment-topology";
import {
  getIngestionObservabilityOverview,
  getIngestionOverview,
} from "@/lib/queries/ingestion";
import type { IngestionRunListItem, IngestionSourceCoverage } from "@/lib/ingestion/types";

export default async function IngestionOpsPage() {
  await connection();
  const [overview, observability] = await Promise.all([
    getIngestionOverview(),
    getIngestionObservabilityOverview(),
  ]);
  const deployment = getDeploymentTopology();
  const scheduledSourceCount = overview.sources.filter((s) => s.isScheduled).length;
  const activeCanonicalCount = overview.liveCount + overview.staleCount;
  const confirmedLiveCount = overview.liveCount - overview.agingCount;
  const visibleCount = observability.lifecycleEvidence.liveCount + observability.lifecycleEvidence.agingCount;
  const lifecycleTrendByDate = new Map(
    observability.lifecycleTransitions7d.map((row) => [row.date, row] as const)
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ingestion Ops</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Connector yield, lifecycle evidence, and live-pool footprint.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/ops/health"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Health
          </Link>
          <Link
            href="/ops/ranking"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Ranking
          </Link>
          <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
            Feed
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-border py-4 sm:grid-cols-4">
        <Field label="Raw jobs" value={String(overview.rawCount)} />
        <Field
          label="Live / aging / active"
          value={`${confirmedLiveCount} / ${overview.agingCount} / ${activeCanonicalCount}`}
        />
        <Field
          label="Held by verify / at risk"
          value={`${observability.lifecycleEvidence.heldByConfirmationCount} / ${observability.lifecycleEvidence.atRiskVisibleCount}`}
        />
        <Field
          label="Stale / expired / removed"
          value={`${overview.staleCount} / ${overview.expiredCount} / ${overview.removedCount}`}
        />
      </div>

      <div className="border-t border-border py-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Classification split
        </p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Field label="Auto-apply eligible" value={String(overview.autoEligibleCount)} />
          <Field label="Review required" value={String(overview.reviewRequiredCount)} />
          <Field label="Manual only" value={String(overview.manualOnlyCount)} />
          <Field label="Scheduled sources" value={String(scheduledSourceCount)} />
        </div>
      </div>

      <section className="grid gap-4 border-t border-border py-4 sm:grid-cols-3">
        <SummaryCard
          title="Current lifecycle"
          rows={[
            { label: "Visible live", value: observability.lifecycleEvidence.liveCount },
            { label: "Visible aging", value: observability.lifecycleEvidence.agingCount },
            { label: "Stale", value: observability.lifecycleEvidence.staleCount },
            { label: "Expired", value: observability.lifecycleEvidence.expiredCount },
            { label: "Removed", value: observability.lifecycleEvidence.removedCount },
          ]}
        />
        <SummaryCard
          title="Freshness backing"
          rows={[
            {
              label: "Source-backed visible",
              value: observability.lifecycleEvidence.sourceBackedVisibleCount,
            },
            {
              label: "Seen in last 3d",
              value: observability.lifecycleEvidence.recentlySeenVisibleCount,
            },
            {
              label: "Confirmed alive in last 3d",
              value: observability.lifecycleEvidence.recentlyConfirmedVisibleCount,
            },
            {
              label: "Visible with dead signal",
              value: observability.lifecycleEvidence.visibleDeadSignalCount,
            },
          ]}
        />
        <SummaryCard
          title="Verification pressure"
          rows={[
            {
              label: "Held by URL confirmation",
              value: observability.lifecycleEvidence.heldByConfirmationCount,
            },
            {
              label: "At-risk visible",
              value: observability.lifecycleEvidence.atRiskVisibleCount,
            },
            {
              label: "Verification backlog",
              value: observability.lifecycleEvidence.verificationBacklogCount,
            },
            {
              label: "Stale but recently confirmed",
              value: observability.lifecycleEvidence.staleRecentlyConfirmedCount,
            },
            {
              label: "Expired with dead signal",
              value: observability.lifecycleEvidence.expiredWithDeadSignalCount,
            },
          ]}
        />
        <DetailCard
          title="Deployment"
          rows={[
            {
              label: "Web app stack runs daemon",
              value: deployment.daemonDisabledInAppStack ? "No" : "Yes",
            },
            {
              label: "Worker public IP",
              value: deployment.workerPublicIpv4 ?? "Not configured",
            },
            {
              label: "Worker private IP",
              value: deployment.workerPrivateIpv4 ?? "Not configured",
            },
            {
              label: "Worker DB route",
              value: deployment.privateWorkerDatabaseRouting
                ? "Private DB URL preferred"
                : "Public/default DB URL",
            },
          ]}
        />
      </section>

      <section className="border-t border-border py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              7d source yield + freshness
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Generated {formatRelativeAge(observability.generatedAt)}. Cached for 5 minutes to
              avoid turning ops checks into production load.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Visible pool {formatCount(visibleCount)} · source mappings{" "}
            {formatCount(overview.sourceMappingCount)}
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs text-muted-foreground">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Visible</th>
                <th className="py-2 pr-3 font-medium">Stale / exp</th>
                <th className="py-2 pr-3 font-medium">Runs 7d</th>
                <th className="py-2 pr-3 font-medium">Fetched</th>
                <th className="py-2 pr-3 font-medium">Accepted</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 pr-3 font-medium">Updated</th>
                <th className="py-2 pr-3 font-medium">Seen &lt;3d</th>
                <th className="py-2 pr-3 font-medium">Confirmed &lt;3d</th>
                <th className="py-2 pr-3 font-medium">Held</th>
                <th className="py-2 pr-3 font-medium">At risk</th>
                <th className="py-2 pr-0 font-medium">Last success</th>
              </tr>
            </thead>
            <tbody>
              {observability.sourceYield7d.map((row) => {
                const visible = row.currentLiveCount + row.currentAgingCount;
                return (
                  <tr key={row.sourceName} className="border-b border-border/40">
                    <td className="py-2 pr-3 text-foreground">
                      <div className="font-medium">{row.sourceName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.isScheduled
                          ? `Scheduled${row.scheduleCadenceMinutes ? ` · ${row.scheduleCadenceMinutes}m` : ""}`
                          : "Managed source"}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {formatCount(visible)}
                      <span className="ml-1 text-[11px] opacity-70">
                        ({formatCount(row.currentAgingCount)} aging)
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {formatCount(row.currentStaleCount)} / {formatCount(row.currentExpiredCount)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatCount(row.successfulRuns7d)}/{formatCount(row.runs7d)}
                    </td>
                    <td className="py-2 pr-3">{formatCount(row.fetched7d)}</td>
                    <td className="py-2 pr-3">{formatCount(row.accepted7d)}</td>
                    <td className="py-2 pr-3 text-foreground">{formatCount(row.created7d)}</td>
                    <td className="py-2 pr-3">{formatCount(row.updated7d)}</td>
                    <td className="py-2 pr-3">{formatCount(row.seenInFreshWindowCount)}</td>
                    <td className="py-2 pr-3">
                      {formatCount(row.confirmedAliveInFreshWindowCount)}
                    </td>
                    <td className="py-2 pr-3">{formatCount(row.heldByConfirmationCount)}</td>
                    <td className="py-2 pr-3">{formatCount(row.atRiskVisibleCount)}</td>
                    <td className="py-2 pr-0">
                      {row.lastSuccessfulRunAt
                        ? formatRelativeAge(row.lastSuccessfulRunAt)
                        : row.lastRunStartedAt
                          ? `failed ${formatRelativeAge(row.lastRunStartedAt)}`
                          : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-border py-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          7d lifecycle snapshots + transitions
        </p>
        <p className="mb-3 text-sm text-muted-foreground">
          Daily snapshots use the last successful run recorded each day. Historical AGING totals
          were not stored before this view, so the trend table combines stored snapshots with
          transition events instead of inventing a fake funnel.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-muted-foreground">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Day</th>
                <th className="py-2 pr-3 font-medium">Snapshot</th>
                <th className="py-2 pr-3 font-medium">Live</th>
                <th className="py-2 pr-3 font-medium">Stale</th>
                <th className="py-2 pr-3 font-medium">Expired</th>
                <th className="py-2 pr-3 font-medium">Removed</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 pr-3 font-medium">Stale in</th>
                <th className="py-2 pr-3 font-medium">Expired in</th>
                <th className="py-2 pr-3 font-medium">Removed in</th>
                <th className="py-2 pr-3 font-medium">Alive confirmed</th>
                <th className="py-2 pr-0 font-medium">Net delta</th>
              </tr>
            </thead>
            <tbody>
              {observability.lifecycleSnapshots7d.map((snapshot) => {
                const transitions = lifecycleTrendByDate.get(snapshot.date);
                const netDelta =
                  (transitions?.createdCount ?? 0) -
                  (transitions?.expiredEnteredCount ?? 0) -
                  (transitions?.removedEnteredCount ?? 0);
                return (
                  <tr key={snapshot.date} className="border-b border-border/40">
                    <td className="py-2 pr-3 text-foreground">{snapshot.date}</td>
                    <td className="py-2 pr-3">
                      {snapshot.snapshotCapturedAt
                        ? formatRelativeAge(snapshot.snapshotCapturedAt)
                        : "missing"}
                    </td>
                    <td className="py-2 pr-3">{formatMaybeCount(snapshot.liveCount)}</td>
                    <td className="py-2 pr-3">{formatMaybeCount(snapshot.staleCount)}</td>
                    <td className="py-2 pr-3">{formatMaybeCount(snapshot.expiredCount)}</td>
                    <td className="py-2 pr-3">{formatMaybeCount(snapshot.removedCount)}</td>
                    <td className="py-2 pr-3">{formatCount(transitions?.createdCount ?? 0)}</td>
                    <td className="py-2 pr-3">
                      {formatCount(transitions?.staleEnteredCount ?? 0)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatCount(transitions?.expiredEnteredCount ?? 0)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatCount(transitions?.removedEnteredCount ?? 0)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatCount(transitions?.aliveConfirmedCount ?? 0)}
                    </td>
                    <td className={`py-2 pr-0 ${netDelta >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                      {netDelta > 0 ? `+${formatCount(netDelta)}` : formatCount(netDelta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1">
          {observability.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      </section>

      <div className="border-t border-border py-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Connector coverage
        </p>
        <div className="space-y-4">
          {overview.sources.map((source) => (
            <SourceCoverageRow key={source.sourceName} source={source} />
          ))}
        </div>
      </div>

      <div className="border-t border-border py-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent runs
          <span className="ml-1.5 opacity-60">{overview.recentRunCount}</span>
        </p>
        {overview.recentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ingestion runs recorded yet. Use{" "}
            <code className="text-xs">npm run ingest -- greenhouse --board=vercel</code> to create
            the first tracked run.
          </p>
        ) : (
          <div className="space-y-4">
            {overview.recentRuns.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between text-sm text-muted-foreground"
          >
            <span>{row.label}</span>
            <span className="font-medium text-foreground">{formatCount(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 text-sm text-muted-foreground"
          >
            <span>{row.label}</span>
            <span className="text-right font-medium text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceCoverageRow({ source }: { source: IngestionSourceCoverage }) {
  return (
    <div className="border-b border-border/60 pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-foreground">{source.sourceName}</p>
        {source.lastRunStatus ? (
          <span className={`text-xs font-medium ${runStatusColor(source.lastRunStatus)}`}>
            {formatDisplayLabel(source.lastRunStatus)}
          </span>
        ) : null}
        {source.isScheduled ? (
          <span className="text-xs text-muted-foreground">
            · Scheduled every {source.scheduleCadenceMinutes}m
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-x-6 gap-y-1 sm:grid-cols-5">
        <SmallField label="Raw" value={source.rawCount} />
        <SmallField label="Active mappings" value={source.activeMappingCount} />
        <SmallField label="Live canonical" value={source.liveCanonicalCount} />
        <SmallField label="Stale" value={source.staleCanonicalCount} />
        <SmallField label="Removed" value={source.removedMappingCount} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {source.lastRunStartedAt
          ? `Last run ${formatRelativeAge(source.lastRunStartedAt)}`
          : "No tracked runs yet"}
        {source.lastSuccessfulRunAt
          ? ` · last success ${formatRelativeAge(source.lastSuccessfulRunAt)}`
          : ""}
      </p>
    </div>
  );
}

function RunRow({ run }: { run: IngestionRunListItem }) {
  return (
    <div className="border-b border-border/60 pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-foreground">{run.sourceName}</p>
        <span className={`text-xs font-medium ${runStatusColor(run.status)}`}>
          {formatDisplayLabel(run.status)}
        </span>
        <span className="text-xs text-muted-foreground">{formatDisplayLabel(run.sourceTier)}</span>
        <span className="text-xs text-muted-foreground">{formatDisplayLabel(run.runMode)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <SmallField label="Fetched" value={run.fetchedCount} />
        <SmallField label="Accepted" value={run.acceptedCount} />
        <SmallField label="Created" value={run.canonicalCreatedCount} />
        <SmallField label="Updated" value={run.canonicalUpdatedCount} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        <span>Rejected: {run.rejectedCount}</span>
        <span>Deduped: {run.dedupedCount}</span>
        <span>
          Mappings +{run.sourceMappingCreatedCount} ~{run.sourceMappingUpdatedCount} -{run.sourceMappingsRemovedCount}
        </span>
        <span>
          Live/stale/expired/removed: {run.liveCount}/{run.staleCount}/{run.expiredCount}/{run.removedCount}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Started {formatRelativeAge(run.startedAt)}
        {run.endedAt ? ` · ${formatRunDuration(run.startedAt, run.endedAt)}` : ""}
      </p>
      {run.errorSummary ? (
        <p className="mt-1 text-xs text-destructive">{run.errorSummary}</p>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function SmallField({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function runStatusColor(status: string) {
  if (status === "SUCCESS") return "text-emerald-600";
  if (status === "FAILED") return "text-destructive";
  return "text-muted-foreground";
}

function formatRunDuration(startedAt: string, endedAt: string) {
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatMaybeCount(value: number | null) {
  return value == null ? "—" : formatCount(value);
}
