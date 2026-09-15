import { prisma } from "@/lib/db";
import { requireCurrentProfileId } from "@/lib/current-user";
import { buildDecisionFacts, decisionFactSelect } from "@/lib/jobs/decision-facts";
import { resolveCompanyLogoDomain } from "@/lib/company-logo";

export function parseComparisonIds(input: string | string[] | undefined) {
  return [...new Set((Array.isArray(input) ? input : input ? [input] : []).filter((id) => id.length > 0 && id.length <= 200))].slice(0, 4);
}

export async function getJobComparison(input: string | string[] | undefined) {
  const userId = await requireCurrentProfileId();
  const candidates = await prisma.savedJob.findMany({ where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { canonicalJob: { select: { id: true, title: true, company: true } } },
  });
  const ids = input === undefined ? candidates.slice(0, 2).map((saved) => saved.canonicalJob.id) : parseComparisonIds(input);
  const selected = await prisma.savedJob.findMany({
    where: { userId, status: "ACTIVE", canonicalJobId: { in: ids } },
    select: { canonicalJob: { select: { ...decisionFactSelect, id: true, title: true, company: true, applyUrl: true,
      companyRecord: { select: { name: true, domain: true, careersUrl: true } },
      eligibility: { select: { submissionCategory: true, reasonDescription: true } },
    } } },
  });
  const options = [...new Map([...candidates, ...selected].map(({ canonicalJob: job }) => [job.id, { id: job.id, title: job.title, company: job.company }])).values()];
  const jobs = selected.map(({ canonicalJob: job }) => ({
    id: job.id, title: job.title, company: job.company,
    companyDomain: resolveCompanyLogoDomain({ company: job.company, companyRecord: job.companyRecord, sourceUrls: [job.applyUrl] }),
    facts: buildDecisionFacts(job),
    readiness: job.eligibility?.submissionCategory ?? null,
    readinessReasons: job.eligibility?.reasonDescription ? [job.eligibility.reasonDescription] : [],
  })).sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
  return { options, jobs, unavailable: ids.length - jobs.length };
}
