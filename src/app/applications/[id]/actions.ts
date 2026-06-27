"use server";

import { cookies } from "next/headers";
import type {
  TrackedApplicationDocumentSlot,
  TrackedApplicationEventType,
  TrackedApplicationStatus,
} from "@/generated/prisma/client";
import {
  requireCurrentAuthUserId,
  requireCurrentUserProfile,
  UnauthorizedError,
} from "@/lib/current-user";
import { prisma } from "@/lib/db";
import {
  fetchFormattedJobDescriptionFromUrl,
  formatJobDescriptionText,
  isJobDescriptionSummaryUsable,
  isLowQualityJobDescription,
  parseJobDescriptionBlocks,
} from "@/lib/job-description-format";
import { inferProfileDocumentMimeType } from "@/lib/profile-resume-service";
import {
  addTrackedApplicationEvent,
  addTrackedApplicationTag,
  deleteTrackedApplicationEvent,
  linkTrackedApplicationDocument,
  removeTrackedApplicationTag,
  unlinkTrackedApplicationDocument,
  updateTrackedApplicationEvent,
  updateTrackedApplicationField,
  updateTrackedApplicationStatus,
} from "@/lib/queries/tracker";
import { revalidateApplicationWorkspaceViews } from "@/lib/revalidation";
import {
  buildDocumentStorageKey,
  deleteFile,
  getStorageReadiness,
  saveFile,
} from "@/lib/storage";
import {
  parseDateTimeLocalInTimeZone,
  USER_TIME_ZONE_COOKIE,
} from "@/lib/time-zone";
import { TRACKED_STATUS_LABEL } from "@/lib/tracker-ui";

type ActionState = {
  error: string | null;
  success: string | null;
};

type SummarizeState = ActionState & {
  fetchFailed?: boolean;
};

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/rtf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/octet-stream",
] as const);

const allowedStatuses = new Set<TrackedApplicationStatus>([
  "WISHLIST",
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "OFFER",
  "ACCEPTED",
  "REJECTED",
  "DECLINED",
  "WITHDRAWN",
]);

const allowedEventTypes = new Set<TrackedApplicationEventType>([
  "NOTE",
  "REMINDER",
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "OFFER",
  "ACCEPTED",
  "REJECTED",
  "DECLINED",
]);

const allowedSlots = new Set<TrackedApplicationDocumentSlot>([
  "SENT_RESUME",
  "SENT_COVER_LETTER",
]);

function toActionState(error: unknown): ActionState {
  return {
    error: error instanceof Error ? error.message : "Request failed.",
    success: null,
  };
}

function inferDocumentMimeType(fileName: string, browserMime: string): string {
  if (browserMime.trim() && browserMime !== "application/octet-stream") {
    return browserMime;
  }

  return inferProfileDocumentMimeType(fileName, browserMime);
}

async function parseReminderDateTimeLocal(rawValue: string, formData: FormData) {
  if (!rawValue) return null;

  const browserTimeZone = String(formData.get("timeZone") ?? "").trim();
  const cookieStore = await cookies();
  const cookieTimeZone = cookieStore.get(USER_TIME_ZONE_COOKIE)?.value;
  return parseDateTimeLocalInTimeZone(rawValue, browserTimeZone || cookieTimeZone);
}

const EDITABLE_APPLICATION_FIELDS = [
  "notes",
  "jobDescription",
  "fitAnalysis",
  "company",
  "roleTitle",
  "roleUrl",
] as const;
type EditableApplicationField = (typeof EDITABLE_APPLICATION_FIELDS)[number];

const APPLICATION_FIELD_LABELS: Record<EditableApplicationField, string> = {
  notes: "Notes",
  jobDescription: "Job description",
  fitAnalysis: "Fit analysis",
  company: "Company",
  roleTitle: "Job title",
  roleUrl: "Job link",
};

/**
 * Update the three "header" identity fields (company, roleTitle, roleUrl)
 * in a single submission. Backed by individual updateTrackedApplicationField
 * calls so existing validation (required, URL format, length caps) is reused.
 */
export async function updateApplicationHeader(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    if (!applicationId) {
      return { error: "Invalid parameters.", success: null };
    }

    const company = String(formData.get("company") ?? "");
    const roleTitle = String(formData.get("roleTitle") ?? "");
    const roleUrl = String(formData.get("roleUrl") ?? "");

    // Update each field in turn so per-field validation messages surface
    // accurately. The DB writes are tiny (one row, no FK joins) so the
    // serialization cost is negligible.
    await updateTrackedApplicationField({ applicationId, field: "company", value: company });
    await updateTrackedApplicationField({ applicationId, field: "roleTitle", value: roleTitle });
    await updateTrackedApplicationField({ applicationId, field: "roleUrl", value: roleUrl });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });

    return {
      error: null,
      success: "Application details saved.",
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function updateApplicationField(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const fieldRaw = String(formData.get("field") ?? "").trim();
    const field = EDITABLE_APPLICATION_FIELDS.find((value) => value === fieldRaw);

    if (!applicationId || !field) {
      return { error: "Invalid parameters.", success: null };
    }

    await updateTrackedApplicationField({
      applicationId,
      field,
      value: String(formData.get("value") ?? ""),
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });

    return {
      error: null,
      success: `${APPLICATION_FIELD_LABELS[field]} saved.`,
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function updateApplicationStatus(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const statusRaw = String(formData.get("status") ?? "").trim().toUpperCase();

    if (!applicationId || !allowedStatuses.has(statusRaw as TrackedApplicationStatus)) {
      return { error: "Invalid parameters.", success: null };
    }

    const status = statusRaw as TrackedApplicationStatus;
    const result = await updateTrackedApplicationStatus({
      applicationId,
      status,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });

    return {
      error: null,
      success: result.changed
        ? `Status updated to ${TRACKED_STATUS_LABEL[status]}.`
        : "Status unchanged.",
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function addTimelineEvent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const typeRaw = String(formData.get("type") ?? "").trim().toUpperCase();

    if (!applicationId || !allowedEventTypes.has(typeRaw as TrackedApplicationEventType)) {
      return { error: "Invalid parameters.", success: null };
    }

    const reminderAtRaw = String(formData.get("reminderAt") ?? "").trim();
    let reminderAt: Date | null = null;

    const note = String(formData.get("note") ?? "").trim();
    if (typeRaw === "REMINDER" && !note) {
      return { error: "Reminder text is required.", success: null };
    }

    if (typeRaw === "REMINDER" && reminderAtRaw) {
      reminderAt = await parseReminderDateTimeLocal(reminderAtRaw, formData);
      if (!reminderAt) {
        return { error: "Invalid reminder date/time.", success: null };
      }
      if (reminderAt <= new Date()) {
        return { error: "Reminder date must be in the future.", success: null };
      }
    }

    await addTrackedApplicationEvent({
      applicationId,
      type: typeRaw as TrackedApplicationEventType,
      note: note || null,
      reminderAt,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: typeRaw === "REMINDER" ? "Reminder added." : "Event added." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function updateTimelineEvent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const eventId = String(formData.get("eventId") ?? "").trim();
    const typeRaw = String(formData.get("type") ?? "").trim().toUpperCase();
    const note = String(formData.get("note") ?? "").trim();
    const reminderAtRaw = String(formData.get("reminderAt") ?? "").trim();

    if (!applicationId || !eventId || typeRaw !== "REMINDER") {
      return { error: "Invalid parameters.", success: null };
    }

    if (!note) {
      return { error: "Reminder text is required.", success: null };
    }

    let reminderAt: Date | null = null;
    if (reminderAtRaw) {
      reminderAt = await parseReminderDateTimeLocal(reminderAtRaw, formData);
      if (!reminderAt) {
        return { error: "Invalid reminder date/time.", success: null };
      }
      if (reminderAt <= new Date()) {
        return { error: "Reminder date must be in the future.", success: null };
      }
    }

    await updateTrackedApplicationEvent({
      applicationId,
      eventId,
      note,
      reminderAt,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: "Reminder saved." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function deleteTimelineEvent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const eventId = String(formData.get("eventId") ?? "").trim();

    if (!applicationId || !eventId) {
      return { error: "Invalid parameters.", success: null };
    }

    await deleteTrackedApplicationEvent({
      applicationId,
      eventId,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: "Event deleted." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function linkDocument(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const documentId = String(formData.get("documentId") ?? "").trim();
    const slotRaw = String(formData.get("slot") ?? "").trim();

    if (!applicationId || !documentId || !allowedSlots.has(slotRaw as TrackedApplicationDocumentSlot)) {
      return { error: "Invalid parameters.", success: null };
    }

    await linkTrackedApplicationDocument({
      applicationId,
      documentId,
      slot: slotRaw as TrackedApplicationDocumentSlot,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: "Document linked." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function unlinkDocument(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const slotRaw = String(formData.get("slot") ?? "").trim();

    if (!applicationId || !allowedSlots.has(slotRaw as TrackedApplicationDocumentSlot)) {
      return { error: "Invalid parameters.", success: null };
    }

    await unlinkTrackedApplicationDocument({
      applicationId,
      slot: slotRaw as TrackedApplicationDocumentSlot,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: "Document unlinked." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function uploadWorkspaceDocument(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const [authUserId, profile] = await Promise.all([
      requireCurrentAuthUserId(),
      requireCurrentUserProfile(),
    ]);

    const storageReadiness = getStorageReadiness();
    if (!storageReadiness.configured) {
      return {
        error: `Storage is not configured. Missing: ${storageReadiness.missingKeys.join(", ")}.`,
        success: null,
      };
    }

    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const slotRaw = String(formData.get("slot") ?? "").trim();
    const titleRaw = String(formData.get("title") ?? "").trim();
    const file = formData.get("file");

    if (!applicationId || !allowedSlots.has(slotRaw as TrackedApplicationDocumentSlot)) {
      return { error: "Invalid parameters.", success: null };
    }

    if (!(file instanceof File) || file.size === 0) {
      return { error: "Please choose a file to upload.", success: null };
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      return { error: "File must be under 10 MB.", success: null };
    }

    const slot = slotRaw as TrackedApplicationDocumentSlot;
    const documentType = slot === "SENT_RESUME" ? "RESUME" : "COVER_LETTER";

    const application = await prisma.trackedApplication.findFirst({
      where: {
        id: applicationId,
        userId: authUserId,
      },
      select: { id: true },
    });

    if (!application) {
      return { error: "Application not found.", success: null };
    }

    const mimeType = inferDocumentMimeType(file.name, file.type);
    if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
      return {
        error: "Unsupported file format. Use PDF, DOCX, DOC, TXT, RTF, PNG, JPG, or WEBP.",
        success: null,
      };
    }

    const title = titleRaw || file.name.replace(/\.[^.]+$/, "");
    const extension = /\.[^.]+$/.exec(file.name)?.[0] ?? ".pdf";
    const storageKey = buildDocumentStorageKey({
      userId: profile.id,
      title,
      extension,
      type: documentType,
    });
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    try {
      await saveFile(storageKey, fileBuffer, { contentType: mimeType });

      await prisma.$transaction(async (tx) => {
        const existingResumeCount =
          documentType === "RESUME"
            ? await tx.document.count({
                where: { userId: profile.id, type: "RESUME" },
              })
            : 0;

        const shouldBePrimary = documentType === "RESUME" && existingResumeCount === 0;

        if (shouldBePrimary) {
          await tx.document.updateMany({
            where: { userId: profile.id, type: "RESUME", isPrimary: true },
            data: { isPrimary: false },
          });
          await tx.resumeVariant.updateMany({
            where: { userId: profile.id, isDefault: true },
            data: { isDefault: false },
          });
        }

        const document = await tx.document.create({
          data: {
            userId: profile.id,
            type: documentType,
            title,
            originalFileName: file.name,
            filename: file.name,
            storageKey,
            mimeType,
            sizeBytes: file.size,
            isPrimary: shouldBePrimary,
          },
        });

        if (documentType === "RESUME") {
          await tx.resumeVariant.create({
            data: {
              userId: profile.id,
              label: title,
              documentId: document.id,
              content: null,
              isDefault: shouldBePrimary,
            },
          });
        }

        await tx.trackedApplicationDocument.upsert({
          where: {
            trackedApplicationId_slot: {
              trackedApplicationId: applicationId,
              slot,
            },
          },
          create: {
            trackedApplicationId: applicationId,
            documentId: document.id,
            slot,
          },
          update: {
            documentId: document.id,
          },
        });

        await tx.trackedApplication.update({
          where: { id: applicationId },
          data: { updatedAt: new Date() },
        });
      });
    } catch (error) {
      try {
        await deleteFile(storageKey);
      } catch {
        // Best-effort cleanup if DB write fails after upload.
      }

      return {
        error: error instanceof Error ? error.message : "Upload failed.",
        success: null,
      };
    }

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return {
      error: null,
      success: `${documentType === "RESUME" ? "Resume" : "Cover letter"} uploaded and linked.`,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { error: "Sign in required.", success: null };
    }
    return toActionState(error);
  }
}

export async function addTag(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();

    if (!applicationId || !name) {
      return { error: "Tag name is required.", success: null };
    }

    const result = await addTrackedApplicationTag({
      applicationId,
      name,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: `Tag "${result.name}" added.` };
  } catch (error) {
    return toActionState(error);
  }
}

export async function removeTag(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const tagId = String(formData.get("tagId") ?? "").trim();

    if (!applicationId || !tagId) {
      return { error: "Invalid parameters.", success: null };
    }

    await removeTrackedApplicationTag({
      applicationId,
      tagId,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: "Tag removed." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function importJobDescription(
  _prev: SummarizeState,
  formData: FormData
): Promise<SummarizeState> {
  try {
    const authUserId = await requireCurrentAuthUserId();
    const applicationId = String(formData.get("applicationId") ?? "").trim();
    const pastedContent = String(formData.get("content") ?? "").trim();

    if (!applicationId) {
      return { error: "Missing application ID.", success: null };
    }

    const application = await prisma.trackedApplication.findFirst({
      where: { id: applicationId, userId: authUserId },
      select: {
        id: true,
        company: true,
        roleTitle: true,
        roleUrl: true,
      },
    });

    if (!application) {
      return { error: "Application not found.", success: null };
    }

    let content: string;

    if (pastedContent && pastedContent.length >= 30) {
      content = pastedContent;
    } else if (application.roleUrl) {
      const fetchedDescription = await fetchFormattedJobDescriptionFromUrl(application.roleUrl);
      if (!fetchedDescription) {
        return {
          error:
            "The fetched page didn't contain enough job details. Paste the full posting text below instead.",
          success: null,
          fetchFailed: true,
        };
      }

      content = fetchedDescription;
    } else if (!pastedContent) {
      return {
        error: "No posting URL set. Paste the job posting content below instead.",
        success: null,
        fetchFailed: true,
      };
    } else {
      return {
        error: "Too little content to format — paste the full job posting text (at least a few sentences).",
        success: null,
        fetchFailed: true,
      };
    }

    const formatted = formatJobDescriptionText(content);
    const structuredBlocks = parseJobDescriptionBlocks(formatted);

    if (
      !formatted ||
      formatted.length < 120 ||
      isLowQualityJobDescription(formatted) ||
      structuredBlocks.length === 0 ||
      !isJobDescriptionSummaryUsable(formatted)
    ) {
      return {
        error: "The fetched page didn't contain enough job details. Paste the full posting text below instead.",
        success: null,
        fetchFailed: true,
      };
    }

    await updateTrackedApplicationField({
      applicationId,
      field: "jobDescription",
      value: formatted,
    });

    revalidateApplicationWorkspaceViews(applicationId, { includeProfile: true });
    return { error: null, success: "Job description imported and organized." };
  } catch (error) {
    return toActionState(error);
  }
}
