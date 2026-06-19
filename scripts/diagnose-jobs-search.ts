/**
 * Diagnose jobs search/filter performance and result-count accuracy.
 *
 * Usage:
 *   npm run jobs:diagnose-search
 *   npm run jobs:diagnose-search -- --search=engineer --scope=title
 *   npm run jobs:diagnose-search -- --company=google
 *
 * With no scenario flags it runs a representative suite and prints, per
 * scenario: the resolved total (or NULL → headline falls back to a lower
 * bound), the page size returned, hasNextPage, and the wall-clock duration of
 * getJobs(). This surfaces slow filter combinations and any non-exact totals.
 */
import { prisma } from "../src/lib/db";
import { getJobs, type JobFilterParams } from "../src/lib/queries/jobs";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function timeIt<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - start)];
}

async function run(label: string, filters: JobFilterParams) {
  try {
    const [result, ms] = await timeIt(() =>
      getJobs({ ...filters, page: filters.page ?? 1 }, { viewerProfileId: null })
    );
    const total =
      result.total === null ? "NULL (headline shows lower bound)" : result.total.toLocaleString();
    const flag = ms > 1500 ? "  ⚠ SLOW" : "";
    console.log(
      `• ${label}\n    total=${total}  rows=${result.data.length}  hasNextPage=${result.hasNextPage}  ${ms}ms${flag}`
    );
  } catch (error) {
    console.log(`• ${label}\n    ERROR: ${(error as Error).message.slice(0, 200)}`);
  }
}

async function main() {
  const customSearch = arg("search");
  const customCompany = arg("company");
  const customTitle = arg("title");
  const scope = (arg("scope") as JobFilterParams["searchScope"]) ?? "all";

  const [feedLive, canonicalLive] = await Promise.all([
    prisma.jobFeedIndex.count({ where: { status: "LIVE" } }),
    prisma.jobCanonical.count({ where: { status: "LIVE" } }),
  ]);
  console.log(`Pool: JobFeedIndex LIVE=${feedLive.toLocaleString()}  JobCanonical LIVE=${canonicalLive.toLocaleString()}\n`);

  if (customSearch || customCompany || customTitle) {
    if (customSearch) await run(`search="${customSearch}" scope=${scope}`, { search: customSearch, searchScope: scope });
    if (customTitle) await run(`titleSearch="${customTitle}"`, { titleSearch: customTitle, searchScope: "title" });
    if (customCompany) await run(`companySearch="${customCompany}"`, { companySearch: customCompany, searchScope: "company" });
  } else {
    await run("no filters", {});
    await run('titleSearch="engineer" (broad)', { titleSearch: "engineer", searchScope: "title" });
    await run('titleSearch="data scientist" (selective)', { titleSearch: "data scientist", searchScope: "title" });
    await run('companySearch="google" (selective)', { companySearch: "google", searchScope: "company" });
    await run('companySearch="amazon" (selective)', { companySearch: "amazon", searchScope: "company" });
    await run("workMode=REMOTE", { workMode: "REMOTE" });
    await run('title="engineer" + workMode=REMOTE', { titleSearch: "engineer", searchScope: "title", workMode: "REMOTE" });
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
