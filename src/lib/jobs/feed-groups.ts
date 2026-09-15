type GroupableEntry = { id: string; job: { company: string; title: string } };

// Presentation grouping only. Requisition IDs, locations, ranks and user state
// remain distinct; a shared title is not sufficient evidence for a DB merge.
export function groupFeedEntries<T extends GroupableEntry>(entries: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const company = entry.job.company.trim().toLowerCase().replace(/\s+/g, " ");
    const title = entry.job.title.trim().toLowerCase().replace(/\s+/g, " ");
    const key = !company || !title || /^(unknown( company)?|confidential)$/.test(company)
      ? JSON.stringify([entry.id]) : JSON.stringify([company, title]);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()];
}
