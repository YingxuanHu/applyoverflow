// Counts are optional UI metadata. Never let a burst monopolize the web pool.
let activeCounts = 0;
const MAX_ACTIVE_COUNTS = 2;

export class JobCountBusyError extends Error {
  constructor() { super("Matching total is temporarily busy"); }
}

export async function runBoundedJobCount<T>(load: () => Promise<T>): Promise<T> {
  if (activeCounts >= MAX_ACTIVE_COUNTS) throw new JobCountBusyError();
  activeCounts += 1;
  try { return await load(); }
  finally { activeCounts -= 1; }
}
