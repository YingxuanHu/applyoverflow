import { type NextRequest } from "next/server";
import { runAutoApply } from "@/lib/automation/engine";
import { resolveATSFiller } from "@/lib/automation/fillers";
import { buildAutoApplyReviewSummary } from "@/lib/automation/review";
import { errorResponse, successResponse } from "@/lib/api-utils";
import { prepareAutoApplyPackage } from "@/lib/queries/applications";
import { recordAction } from "@/lib/queries/behavior";
import { saveJob } from "@/lib/queries/saved-jobs";
import { syncTrackedApplicationFromSubmission } from "@/lib/queries/tracker";
import { requireCurrentProfileId, UnauthorizedError } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import type { AutomationRunMode } from "@/lib/automation/types";

const VALID_MODES: AutomationRunMode[] = ["fill_and_submit"];
const VALID_INTENTS = ["review", "submit"] as const;
type AutoApplyIntent = (typeof VALID_INTENTS)[number];

/**
 * POST /api/jobs/[id]/auto-apply
 *
 * Review or submit automation for a single job.
 *
 * Body (all optional — if `resumeVariantId` is provided, we upsert an
 * ApplicationPackage with the user's selections *before* running the
 * engine so the correct materials are picked up):
 *
 *   {
 *     resumeVariantId?: string;        // from AutoApplyWorkspace picker
 *     coverLetterContent?: string;     // optional cover letter text
 *     answers?: Record<string, string>;// per-job screening question answers
 *     intent: "review" | "submit";
 *     confirmSubmission?: boolean;    // required for submit
 *     mode?: "fill_and_submit";       // submit only
 *   }
 *
 * This route intentionally has no legacy "submit by default" path. A caller
 * must first ask for a review/preflight and then submit with explicit user
 * confirmation.
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
    let intent: AutoApplyIntent = "review";
    let mode: AutomationRunMode = "fill_and_submit";
    let confirmSubmission = false;
    let resumeVariantId: string | undefined;
    let coverLetterContent: string | null | undefined;
    let answers: Record<string, string> | undefined;

    try {
      const body = (await request.json()) as {
        intent?: string;
        confirmSubmission?: boolean;
        mode?: string;
        resumeVariantId?: string;
        coverLetterContent?: string | null;
        answers?: Record<string, string>;
      };

      if (body?.intent && typeof body.intent === "string") {
        if (!VALID_INTENTS.includes(body.intent as AutoApplyIntent)) {
          return errorResponse(
            `Invalid intent: ${body.intent}. Use: ${VALID_INTENTS.join(", ")}`,
            400
          );
        }
        intent = body.intent as AutoApplyIntent;
      }
      confirmSubmission = body?.confirmSubmission === true;
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
      return errorResponse("Apply assistant requires a JSON body with intent.", 400);
    }

    if (!resumeVariantId) {
      return errorResponse("Choose a resume before reviewing this application.", 400);
    }

    if (intent === "submit" && !confirmSubmission) {
      return errorResponse("Review and explicit confirmation are required before submission.", 400);
    }

    const job = await prisma.jobCanonical.findUnique({
      where: { id },
      select: {
        id: true,
        applyUrl: true,
        status: true,
        title: true,
        company: true,
        eligibility: { select: { submissionCategory: true } },
      },
    });

    if (!job) {
      return errorResponse("Job not found", 404);
    }

    const atsFiller = resolveATSFiller(job.applyUrl);
    if (job.status !== "LIVE" || !atsFiller) {
      return errorResponse(
        "This application cannot be completed in the app yet. Open the employer posting and apply manually.",
        409
      );
    }

    if (job.eligibility?.submissionCategory === "MANUAL_ONLY") {
      return errorResponse(
        "This application is manual apply. Use the employer posting or tracked apply flow.",
        409
      );
    }

    // ─── Upsert the ApplicationPackage with the user's chosen materials ─
    // This happens BEFORE runAutoApply so the engine, which reads the
    // package via candidate.packageId, picks up the correct resume.
    let preparedPackage: Awaited<ReturnType<typeof prepareAutoApplyPackage>>;
    try {
      preparedPackage = await prepareAutoApplyPackage(id, {
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

    const review = await runReviewPreflight({
      jobId: id,
      userId,
      atsName: atsFiller.atsName,
      savedAnswers: preparedPackage.savedAnswers,
    });

    if (intent === "review") {
      return successResponse({
        jobId: id,
        intent,
        review,
      });
    }

    if (!review.canSubmit) {
      return successResponse(
        {
          jobId: id,
          intent,
          review,
          error:
            "Required fields, blockers, or unsupported form behavior prevent safe auto-submit.",
        },
        409
      );
    }

    // ─── Run the automation engine ─────────────────────────────────
    const results = await runAutoApply({
      jobId: id,
      userId,
      mode,
      maxPerRun: 1,
      delayBetweenMs: 0,
      recordResult: true,
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
      review,
    });
  } catch (error) {
    console.error("POST /api/jobs/[id]/auto-apply error:", error);
    return errorResponse("Automation failed", 500);
  }
}

async function runReviewPreflight(input: {
  jobId: string;
  userId: string;
  atsName: string;
  savedAnswers?: Record<string, string>;
}) {
  const results = await runAutoApply({
    jobId: input.jobId,
    userId: input.userId,
    mode: "dry_run",
    maxPerRun: 1,
    delayBetweenMs: 0,
    recordResult: false,
    log: () => {},
  });
  const result = results[0];
  return buildAutoApplyReviewSummary({
    atsName: input.atsName,
    result: result?.fillerResult ?? null,
    error: result?.error ?? null,
    savedAnswers: input.savedAnswers,
  });
}

async function syncSubmittedApplication(jobId: string) {
  const [tracked] = await Promise.all([
    syncTrackedApplicationFromSubmission(jobId),
    recordAction(jobId, "APPLY"),
    saveJob(jobId, "APPLIED"),
  ]);
  return tracked;
}
