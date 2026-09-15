import { prisma } from "@/lib/db";
import { requireCurrentProfileId } from "@/lib/current-user";
import { jobDataReportSchema } from "@/lib/jobs/data-report";

export async function reportJobData(canonicalJobId: string, input: unknown) {
  const userId = await requireCurrentProfileId();
  const data = jobDataReportSchema.parse(input);
  const job = await prisma.jobCanonical.findUnique({ where: { id: canonicalJobId }, select: { id: true } });
  if (!job) return null;
  // At most one report per person/job/category. Repeated submissions cannot
  // inflate priority or reopen a moderator's decision.
  return prisma.jobDataReport.upsert({
    where: { userId_canonicalJobId_category: { userId, canonicalJobId, category: data.category } },
    create: { userId, canonicalJobId, ...data },
    update: {},
    select: { id: true, status: true },
  });
}
