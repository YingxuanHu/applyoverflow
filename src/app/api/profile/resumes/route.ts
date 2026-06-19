import { type NextRequest } from "next/server";

import {
  API_BODY_LIMITS,
  errorResponse,
  isUnauthorizedApiError,
  rateLimitResponse,
  requestSizeLimitResponse,
  successResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentUserProfile } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { importUploadedResumeForProfile } from "@/lib/profile-resume-service";
import { revalidateProfileViews } from "@/lib/revalidation";
import { getStorageReadiness } from "@/lib/storage";

export async function GET() {
  try {
    const user = await requireCurrentUserProfile();
    const resumes = await prisma.document.findMany({
      where: {
        userId: user.id,
        type: "RESUME",
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        isPrimary: true,
      },
    });

    return successResponse(resumes);
  } catch (error) {
    if (isUnauthorizedApiError(error)) return unauthorizedResponse();
    return errorResponse("Failed to fetch resumes", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const tooLarge = requestSizeLimitResponse(
      request,
      API_BODY_LIMITS.resumeUpload,
      "Resume upload"
    );
    if (tooLarge) return tooLarge;

    const rateLimited = await rateLimitResponse(
      request,
      "document:resume-upload",
      API_RATE_LIMITS.documentUpload
    );
    if (rateLimited) return rateLimited;

    const user = await requireCurrentUserProfile();
    const storageReadiness = getStorageReadiness();
    if (!storageReadiness.configured) {
      return errorResponse(
        `Storage is not configured. Missing: ${storageReadiness.missingKeys.join(", ")}.`,
        500
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return errorResponse("Choose a supported resume file.", 400);
    }

    const result = await importUploadedResumeForProfile({
      user,
      file,
      titleRaw: String(formData.get("title") ?? "").trim(),
      makePrimary: formData.get("makePrimary") === "on",
    });

    revalidateProfileViews();
    return successResponse({ message: result.message }, 201);
  } catch (error) {
    if (isUnauthorizedApiError(error)) return unauthorizedResponse();
    return errorResponse(
      error instanceof Error ? error.message : "Resume upload failed.",
      400
    );
  }
}
