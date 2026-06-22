import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { rateLimitResponse } from "@/lib/api-utils";
import {
  ReauthenticationRequiredError,
  UnauthorizedError,
  requireCurrentUserIds,
  requireFreshSensitiveSession,
} from "@/lib/current-user";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "settings:data-export",
      API_RATE_LIMITS.dataExport
    );
    if (rateLimited) return rateLimited;

    await requireFreshSensitiveSession();
    const { authUserId, profileId } = await requireCurrentUserIds();

    const [
      user,
      profile,
      trackedApplications,
      notifications,
      reminderLogs,
      savedJobs,
      behaviorSignals,
      applicationPackages,
      applicationSubmissions,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: authUserId },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerified: true,
          emailNotificationsEnabled: true,
          image: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.userProfile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          authUserId: true,
          email: true,
          name: true,
          phone: true,
          location: true,
          headline: true,
          summary: true,
          linkedinUrl: true,
          githubUrl: true,
          portfolioUrl: true,
          workAuthorization: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
          preferredWorkMode: true,
          experienceLevel: true,
          contactJson: true,
          skillsText: true,
          experienceText: true,
          educationText: true,
          projectsText: true,
          skillsJson: true,
          experiencesJson: true,
          educationsJson: true,
          projectsJson: true,
          createdAt: true,
          updatedAt: true,
          preferences: {
            orderBy: { key: "asc" },
            select: {
              key: true,
              value: true,
              isHardFilter: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          resumeVariants: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              label: true,
              targetRoleFamily: true,
              fileUrl: true,
              content: true,
              isDefault: true,
              documentId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          documents: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              type: true,
              title: true,
              originalFileName: true,
              filename: true,
              mimeType: true,
              sizeBytes: true,
              isPrimary: true,
              isAiGenerated: true,
              sourceApplicationId: true,
              extractedText: true,
              extractedAt: true,
              createdAt: true,
              updatedAt: true,
              analysis: {
                select: {
                  extractedText: true,
                  keywordsJson: true,
                  sectionsJson: true,
                  structuredProfileJson: true,
                  importSummaryJson: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      }),
      prisma.trackedApplication.findMany({
        where: { userId: authUserId },
        orderBy: { updatedAt: "desc" },
        include: {
          events: { orderBy: { timestamp: "desc" } },
          tags: { include: { tag: true } },
          documentLinks: {
            include: {
              document: {
                select: {
                  id: true,
                  type: true,
                  title: true,
                  originalFileName: true,
                  isPrimary: true,
                  isAiGenerated: true,
                  sourceApplicationId: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
          canonicalJob: {
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              region: true,
              workMode: true,
              employmentType: true,
              experienceLevel: true,
              industry: true,
              roleFamily: true,
              applyUrl: true,
              postedAt: true,
              deadline: true,
              status: true,
            },
          },
        },
      }),
      prisma.notification.findMany({
        where: { userId: authUserId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.reminderLog.findMany({
        where: { userId: authUserId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.savedJob.findMany({
        where: { userId: profileId },
        orderBy: { updatedAt: "desc" },
        include: {
          canonicalJob: {
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              applyUrl: true,
              status: true,
              postedAt: true,
              deadline: true,
            },
          },
        },
      }),
      prisma.userBehaviorSignal.findMany({
        where: { userId: profileId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.applicationPackage.findMany({
        where: { userId: profileId },
        orderBy: { updatedAt: "desc" },
        include: {
          canonicalJob: {
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              applyUrl: true,
              status: true,
            },
          },
          resumeVariant: {
            select: {
              id: true,
              label: true,
              targetRoleFamily: true,
              isDefault: true,
              documentId: true,
            },
          },
        },
      }),
      prisma.applicationSubmission.findMany({
        where: { userId: profileId },
        orderBy: { updatedAt: "desc" },
        include: {
          canonicalJob: {
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              applyUrl: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const exportedAt = new Date();
    const payload = {
      exportedAt: exportedAt.toISOString(),
      schema: "applyoverflow-user-export-v1",
      user,
      profile,
      tracker: {
        applications: trackedApplications,
        notifications,
        reminderLogs,
      },
      jobs: {
        savedJobs,
        behaviorSignals,
        applicationPackages,
        applicationSubmissions,
      },
    };
    const safeDate = exportedAt.toISOString().slice(0, 10);

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Disposition": `attachment; filename="applyoverflow-export-${safeDate}.json"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    if (error instanceof ReauthenticationRequiredError) {
      return Response.json({ error: error.message }, { status: 401 });
    }

    console.error("[settings.export] Failed to build data export", error);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}
