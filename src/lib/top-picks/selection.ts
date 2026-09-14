type CandidateBatch = { channel: string; ids: string[] };

export function mergeCandidateChannels(batches: CandidateBatch[], limit: number) {
  const channelsById = new Map<string, Set<string>>();
  const ids: string[] = [];
  const candidatesByChannel = Object.fromEntries(batches.map((batch) => [batch.channel, batch.ids.length]));
  const positions = batches.map(() => 0);
  // Each channel gets a turn, including when earlier channels fill their quota.
  while (ids.length < limit) {
    let added = false;
    for (const [index, batch] of batches.entries()) {
      while (positions[index] < batch.ids.length) {
        const id = batch.ids[positions[index]++];
        if (channelsById.has(id)) continue;
        ids.push(id);
        channelsById.set(id, new Set());
        added = true;
        break;
      }
      if (ids.length >= limit) break;
    }
    if (!added) break;
  }
  for (const batch of batches) for (const id of batch.ids) channelsById.get(id)?.add(batch.channel);
  return { ids, channelsById, candidatesByChannel };
}

type RankedJob = {
  score: number;
  job: { id: string; company: string; title: string; location: string; postedAt: Date | null };
};

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function selectTopPicks<T extends RankedJob>(scored: T[], limit: number): T[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score || (b.job.postedAt?.getTime() ?? 0) - (a.job.postedAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id));
  const seenIds = new Set<string>();
  const seenPostings = new Set<string>();
  const candidates = sorted.filter((item) => {
    // Keep parenthetical specialties and seniority: they can be different roles.
    const key = [item.job.company, item.job.title, item.job.location].map(normalized).join("::");
    if (seenIds.has(item.job.id) || seenPostings.has(key)) return false;
    seenIds.add(item.job.id);
    seenPostings.add(key);
    return true;
  });
  const output: T[] = [];
  const companies = new Map(candidates.map((item) => [item.job.id, normalized(item.job.company)]));
  while (candidates.length && output.length < limit) {
    const recentCounts = new Map<string, number>();
    for (const pick of output.slice(-9)) {
      const company = companies.get(pick.job.id)!;
      recentCounts.set(company, (recentCounts.get(company) ?? 0) + 1);
    }
    let chosen = 0;
    let bestAdjusted = -Infinity;
    for (let index = 0; index < candidates.length; index++) {
      const item = candidates[index];
      // Diversity never displaces a meaningfully stronger match.
      if (item.score < candidates[0].score - 8) break;
      const companyCount = recentCounts.get(companies.get(item.job.id)!) ?? 0;
      const adjusted = item.score - Math.min(9, companyCount * 3);
      if (adjusted > bestAdjusted) { bestAdjusted = adjusted; chosen = index; }
    }
    output.push(candidates.splice(chosen, 1)[0]);
  }
  return output;
}
