import { type NextRequest } from "next/server";
import { runAutoApply } from "@/lib/automation/engine";
import { resolveATSFiller } from "@/lib/automation/fillers";
import { errorResponse, successResponse } from "@/lib/api-utils";
import { prepareAutoApplyPackage } from "@/lib/queries/applications";
import { recordAction } from "@/lib/queries/behavior";
import { saveJob } from "@/lib/queries/saved-jobs";
import { syncTrackedApplicationFromSubmission } from "@/lib/queries/tracker";
import { requireCurrentProfileId, UnauthorizedError } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import type { AutomationRunMode } from "@/lib/automation/types";

const VALID_MODES: AutomationRunMode[] = ["fill_and_submit"];

/**
 * POST /api/jobs/[id]/auto-apply
 *
 * Trigger automation for a single job.
 *
 * Body (all optional — if `resumeVariantId` is provided, we upsert an
 * ApplicationPackage with the user's selections *before* running the
 * engine so the correct materials are picked up):
 *
 *   {
 *     resumeVariantId?: string;        // from AutoApplyWorkspace picker
 *     coverLetterContent?: string;     // optional cover letter text
 *     answers?: Record<string, string>;// per-job screening question answers
 *     mode?: "fill_and_submit";
 *   }
 *
 * If no body is provided, this endpoint attempts a conservative submit
 * using the latest prepared package, but only for URLs with a registered
 * submit-capable ATS filler.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let userId: string;

    try {
      userId = await requireCurrentProfileId();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return errorResponse("Unauthorized", 401);
      }
      throw error;
    }

    // ─── Parse body ─────────────────────────────────────────────────
    let mode: AutomationRunMode = "fill_and_submit";
    let resumeVariantId: string | undefined;
    let coverLetterContent: string | null | undefined;
    let answers: Record<string, string> | undefined;

    try {
      const body = (await request.json()) as {
        mode?: string;
        resumeVariantId?: string;
        coverLetterContent?: string | null;
        answers?: Record<string, string>;
      };

      if (body?.mode && typeof body.mode === "string") {
        if (!VALID_MODES.includes(body.mode as AutomationRunMode)) {
          return errorResponse(
            `Invalid mode: ${body.mode}. Use: ${VALID_MODES.join(", ")}`,
            400
          );
        }
        mode = body.mode as AutomationRunMode;
      }
      if (typeof body?.resumeVariantId === "string" && body.resumeVariantId.length > 0) {
        resumeVariantId = body.resumeVariantId;
      }
      if (typeof body?.coverLetterContent === "string") {
        coverLetterContent = body.coverLetterContent;
      }
      if (body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
        const entries = Object.entries(body.answers).filter(
          ([, value]) => typeof value === "string"
        ) as Array<[string, string]>;
        answers = Object.fromEntries(entries);
      }
    } catch {
      // No body or invalid JSON — use legacy path.
    }

    const job = await prisma.jobCanonical.findUnique({
      where: { id },
      select: {
        id: true,
        applyUrl: true,
        status: true,
        eligibility: { select: { submissionCategory: true } },
      },
    });

    if (!job) {
      return errorResponse("Job not found", 404);
    }

    const atsFiller = resolveATSFiller(job.applyUrl);
    if (
      job.status !== "LIVE" ||
      job.eligibility?.submissionCategory !== "AUTO_SUBMIT_READY" ||
      !atsFiller
    ) {
      return errorResponse(
        "This job is not eligible for auto-apply. Open the original posting and apply manually.",
        409
      );
    }

    // ─── Upsert the ApplicationPackage with the user's chosen materials ─
    // This happens BEFORE runAutoApply so the engine, which reads the
    // package via candidate.packageId, picks up the correct resume.
    if (resumeVariantId) {
      try {
        await prepareAutoApplyPackage(id, {
          resumeVariantId,
          coverLetterContent: coverLetterContent ?? null,
          savedAnswers: answers,
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          return errorResponse("Unauthorized", 401);
        }
        const msg = error instanceof Error ? error.message : "Could not prepare package";
        return errorResponse(msg, 400);
      }
    }

    // ─── Run the automation engine ─────────────────────────────────
    const results = await runAutoApply({
      jobId: id,
      userId,
      mode,
      maxPerRun: 1,
      delayBetweenMs: 0,
      log: () => {}, // Suppress logging in API context
    });

    const result = results[0];
    if (!result) {
      return errorResponse("Job not found or not eligible for automation", 404);
    }

    if (result.error) {
      return errorResponse(result.error, 502);
    }

    const filler = result.fillerResult!;
    const trackedApplication =
      filler.status === "submitted"
        ? await syncSubmittedApplication(id)
        : null;

    return successResponse({
      jobId: id,
      status: filler.status,
      atsName: filler.atsName,
      mode,
      applicationId: trackedApplication?.id ?? null,
      filledFieldCount: filler.filledFields.length,
      unfillableFieldCount: filler.unfillableFields.length,
      blockers: filler.blockers,
      screenshots: filler.screenshots,
      submittedAt: filler.submittedAt?.toISOString() ?? null,
      notes: filler.notes,
      durationMs: filler.durationMs,
    });
  } catch (error) {
    console.error("POST /api/jobs/[id]/auto-apply error:", error);
    return errorResponse("Automation failed", 500);
  }
}

async function syncSubmittedApplication(jobId: string) {
  const [tracked] = await Promise.all([
    syncTrackedApplicationFromSubmission(jobId),
    recordAction(jobId, "APPLY"),
    saveJob(jobId, "APPLIED"),
  ]);
  return tracked;
}
