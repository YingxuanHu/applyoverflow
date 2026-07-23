import { redirect } from "next/navigation";

import { ResumeBuilder } from "@/components/profile/resume-builder";
import { getOptionalSessionUser, requireCurrentProfileId } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { formatMediumDateTimeEnCa } from "@/lib/formatting";
import { normalizeResumeBullets } from "@/lib/resume-builder";

export default async function ResumeBuilderPage() {
  const sessionUser = await getOptionalSessionUser();
  if (!sessionUser) {
    redirect("/sign-in");
  }

  const profileId = await requireCurrentProfileId();
  const [entries, builds, savedJobs] = await Promise.all([
    prisma.resumeLibraryEntry.findMany({
      where: { userId: profileId, archivedAt: null },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
      include: {
        variations: {
          where: { approvalStatus: { not: "REJECTED" } },
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
          select: {
            id: true,
            name: true,
            sourceVariationId: true,
            rewrittenBulletIndexes: true,
            summary: true,
            bulletsJson: true,
            targetRoleTags: true,
            source: true,
            approvalStatus: true,
            isDefault: true,
          },
        },
      },
    }),
    prisma.resumeBuild.findMany({
      where: { userId: profileId },
      orderBy: { updatedAt: "desc" },
      take: 24,
      select: {
        id: true,
        name: true,
        status: true,
        updatedAt: true,
        targetJob: { select: { title: true, company: true } },
        outputDocument: { select: { id: true, title: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.savedJob.findMany({
      where: { userId: profileId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        canonicalJobId: true,
        canonicalJob: { select: { title: true, company: true } },
      },
    }),
  ]);

  return (
    <main className="app-page">
      <ResumeBuilder
        builds={builds.map((build) => ({
          id: build.id,
          name: build.name,
          status: build.status,
          updatedAtLabel: formatMediumDateTimeEnCa(build.updatedAt),
          itemCount: build._count.items,
          targetJobLabel: build.targetJob
            ? `${build.targetJob.title} at ${build.targetJob.company}`
            : null,
          outputDocument: build.outputDocument
            ? {
                title: build.outputDocument.title,
                href: `/api/profile/documents/${build.outputDocument.id}/download`,
              }
            : null,
        }))}
        entries={entries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          title: entry.title,
          organization: entry.organization,
          dateRange: entry.dateRange,
          location: entry.location,
          summary: entry.summary,
          technologies: entry.technologies,
          sourceProfileKey: entry.sourceProfileKey,
          variations: entry.variations.map((variation) => ({
            id: variation.id,
            name: variation.name,
            sourceVariationId: variation.sourceVariationId,
            rewrittenBulletIndexes: variation.rewrittenBulletIndexes,
            summary: variation.summary,
            bullets: normalizeResumeBullets(variation.bulletsJson),
            targetRoleTags: variation.targetRoleTags,
            source: variation.source,
            approvalStatus: variation.approvalStatus,
            isDefault: variation.isDefault,
          })),
        }))}
        savedJobs={savedJobs.map((savedJob) => ({
          id: savedJob.canonicalJobId,
          label: `${savedJob.canonicalJob.title} at ${savedJob.canonicalJob.company}`,
        }))}
      />
    </main>
  );
}
