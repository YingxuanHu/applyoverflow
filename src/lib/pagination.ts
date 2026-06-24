export type PaginationItem = number | "gap";

export function getPaginationItems({
  currentPage,
  hasNextPage = false,
  totalPages,
}: {
  currentPage: number;
  hasNextPage?: boolean;
  totalPages: number | null;
}): PaginationItem[] {
  if (totalPages === null) {
    const pages = new Set<number>([1, currentPage]);
    if (currentPage > 1) pages.add(currentPage - 1);
    if (hasNextPage) pages.add(currentPage + 1);
    return [...pages].sort((left, right) => left - right);
  }

  const safeTotal = Math.max(1, totalPages);
  const safeCurrent = Math.min(Math.max(1, currentPage), safeTotal);

  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, safeTotal, safeCurrent]);
  if (safeCurrent <= 4) {
    for (let page = 2; page <= 5; page += 1) pages.add(page);
  } else if (safeCurrent >= safeTotal - 3) {
    for (let page = safeTotal - 4; page < safeTotal; page += 1) pages.add(page);
  } else {
    pages.add(safeCurrent - 1);
    pages.add(safeCurrent + 1);
  }

  const sortedPages = [...pages]
    .filter((page) => page >= 1 && page <= safeTotal)
    .sort((left, right) => left - right);
  const items: PaginationItem[] = [];
  for (const page of sortedPages) {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      items.push("gap");
    }
    items.push(page);
  }

  return items;
}
