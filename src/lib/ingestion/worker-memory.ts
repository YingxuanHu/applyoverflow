export function workerMemoryPressure(
  memory = process.memoryUsage(),
  limitMb = Number(process.env.INGEST_WORKER_SOFT_RSS_MB ?? 0),
) {
  if (!Number.isFinite(limitMb) || limitMb <= 0 || memory.rss < limitMb * 1024 * 1024) return null;
  return {
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    externalMb: Math.round(memory.external / 1024 / 1024),
    limitMb,
  };
}

export function shouldYieldForWorkerMemory(label: string) {
  const pressure = workerMemoryPressure();
  if (pressure) console.warn(`[worker-memory] ${label}: draining at a batch boundary`, pressure);
  return pressure !== null;
}
