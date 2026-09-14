export type ReportSection<T> = {
  data: T | null;
  elapsedMs: number;
  error: string | null;
};

// Deferred functions are important: passing promises starts every query before
// the loop and exhausts the maintenance connection pool.
export async function collectReportSections<T extends Record<string, () => Promise<unknown>>>(
  tasks: T,
): Promise<{ [K in keyof T]: ReportSection<Awaited<ReturnType<T[K]>>> }> {
  const sections: Record<string, ReportSection<unknown>> = {};
  for (const [name, load] of Object.entries(tasks)) {
    const started = Date.now();
    try {
      sections[name] = { data: await load(), elapsedMs: Date.now() - started, error: null };
    } catch {
      // Do not persist SQL, connection strings, or raw driver errors in reports.
      sections[name] = { data: null, elapsedMs: Date.now() - started, error: "Section unavailable or exceeded its query budget" };
    }
  }
  return sections as { [K in keyof T]: ReportSection<Awaited<ReturnType<T[K]>>> };
}
