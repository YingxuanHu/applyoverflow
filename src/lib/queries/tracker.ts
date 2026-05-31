import type { Prisma, TrackedApplicationDocumentSlot, TrackedApplicationEventType, TrackedApplicationStatus } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import {
  formatJobDescriptionText,
  pickBestFormattedJobDescription,
} from "@/lib/job-description-format";
import {
  requireCurrentAuthUserId,
  requireCurrentProfileId,
} from "@/lib/current-user";
import { checkSingleTrackedApplicationReminder } from "@/lib/reminders";
import { TRACKED_ACTIVE_STATUSES } from "@/lib/tracker-constants";

export type TrackerDeadlineFilter = "ALL" | "UPCOMING" | "OVERDUE" | "NO_DEADLINE";
export type TrackerSortFilter =
  | "UPDATED_DESC"
  | "UPDATED_ASC"
  | "DEADLINE_ASC"
  | "DEADLINE_DESC"
  | "COMPANY_ASC"
  | "COMPANY_DESC";
export type TrackerSearchScope = "all" | "title" | "company" | "location" | "tag" | "reminder";

const TRACKED_SEARCH_STATUS_LABELS: Array<{
  status: TrackedApplicationStatus;
  labels: string[];
}> = [
  { status: "WISHLIST", labels: ["wishlist", "wishlisted", "saved"] },
  { status: "PREPARING", labels: ["preparing", "prepare"] },
  { status: "APPLIED", labels: ["applied", "submitted"] },
  { status: "SCREEN", labels: ["screen", "screening"] },
  { status: "INTERVIEW", labels: ["interview"] },
  { status: "OFFER", labels: ["offer"] },
  { status: "REJECTED", labels: ["rejected"] },
  { status: "WITHDRAWN", labels: ["withdrawn"] },
];

function startOfUtcDay(value: Date) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function normalizeOptionalUrl(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }

  return trimmed;
}

function queueReminderCheck(applicationId: string) {
  void checkSingleTrackedApplicationReminder(applicationId).catch((error) => {
    console.error("Tracked application reminder check failed:", error);
  });
}

function normalizeTagNames(raw: string | string[]) {
  const tokens = Array.isArray(raw) ? raw : raw.split(",");

  return [...new Set(
    tokens
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.slice(0, 40))
  )].sort((left, right) => left.localeCompare(right));
}

function getNormalizedTrackedJobDescription(description: string | null | undefined) {
  const cleaned = String(description ?? "").trim();
  if (!cleaned) {
    return null;
  }

  return pickBestFormattedJobDescription([formatJobDescriptionText(cleaned), cleaned]) ?? cleaned;
}

function statusToEventType(status: TrackedApplicationStatus): TrackedApplicationEventType {
  switch (status) {
    case "APPLIED":
      return "APPLIED";
    case "SCREEN":
      return "SCREEN";
    case "INTERVIEW":
      return "INTERVIEW";
    case "OFFER":
      return "OFFER";
    case "REJECTED":
      return "REJECTED";
    case "PREPARING":
    case "WISHLIST":
    case "WITHDRAWN":
    default:
      return "NOTE";
  }
}

function resolveTrackedStatusFromJobUpsert(
  currentStatus: TrackedApplicationStatus | null | undefined,
  requestedStatus: TrackedApplicationStatus
): TrackedApplicationStatus {
  if (!currentStatus) {
    return requestedStatus;
  }

  if (requestedStatus === "WISHLIST") {
    return currentStatus;
  }

  if (requestedStatus === "PREPARING") {
    return currentStatus === "WISHLIST" ? "PREPARING" : currentStatus;
  }

  return requestedStatus;
}

function isDocumentTypeCompatibleWithSlot(
  slot: TrackedApplicationDocumentSlot,
  documentType: string
) {
  if (slot === "SENT_RESUME") {
    return documentType === "RESUME";
  }

  return documentType === "COVER_LETTER";
}

function getIncompatibleDocumentTypeMessage(slot: TrackedApplicationDocumentSlot) {
  if (slot === "SENT_RESUME") {
    return "Only uploaded resumes can be linked to the resume slot.";
  }

  return "Only uploaded cover letters can be linked to the cover letter slot.";
}

async function upsertTrackedApplicationResumeDocument(input: {
  applicationId: string;
  profileId: string;
  documentId: string | null | undefined;
}) {
  if (!input.documentId) {
    return;
  }

  const resumeDocument = await prisma.document.findFirst({
    where: {
      id: input.documentId,
      userId: input.profileId,
      type: "RESUME",
    },
    select: { id: true },
  });

  if (!resumeDocument) {
    return;
  }

  await prisma.trackedApplicationDocument.upsert({
    where: {
      trackedApplicationId_slot: {
        trackedApplicationId: input.applicationId,
        slot: "SENT_RESUME",
      },
    },
    create: {
      trackedApplicationId: input.applicationId,
      documentId: resumeDocument.id,
      slot: "SENT_RESUME",
    },
    update: {
      documentId: resumeDocument.id,
    },
  });
}

function buildTrackedOrderBy(sort: TrackerSortFilter): Prisma.TrackedApplicationOrderByWithRelationInput[] {
  switch (sort) {
    case "UPDATED_ASC":
      return [{ updatedAt: "asc" }];
    case "DEADLINE_ASC":
      return [{ deadline: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }];
    case "DEADLINE_DESC":
      return [{ deadline: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }];
    case "COMPANY_ASC":
      return [{ company: "asc" }, { updatedAt: "desc" }];
    case "COMPANY_DESC":
      return [{ company: "desc" }, { updatedAt: "desc" }];
    case "UPDATED_DESC":
    default:
      return [{ updatedAt: "desc" }];
  }
}

function appendTrackedAndCondition(
  where: Prisma.TrackedApplicationWhereInput,
  condition: Prisma.TrackedApplicationWhereInput
) {
  const existing = where.AND
    ? Array.isArray(where.AND)
      ? where.AND
      : [where.AND]
    : [];
  where.AND = [...existing, condition];
}

function buildTrackedSearchTokens(search: string) {
  const normalized = search.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!normalized) return [];

  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }

  return tokens;
}

function buildTrackedAllSearchTokenWhere(
  query: string,
  userId: string
): Prisma.TrackedApplicationWhereInput {
  const normalizedQuery = query.toLowerCase();
  const matchedStatuses = TRACKED_SEARCH_STATUS_LABELS
    .filter(({ labels }) =>
      labels.some((label) => label.includes(normalizedQuery) || normalizedQuery.includes(label))
    )
    .map(({ status }) => status);

  const clauses: Prisma.TrackedApplicationWhereInput[] = [
    { company: { contains: query, mode: "insensitive" } },
    { roleTitle: { contains: query, mode: "insensitive" } },
    { roleUrl: { contains: query, mode: "insensitive" } },
    { notes: { contains: query, mode: "insensitive" } },
    {
      canonicalJob: {
        is: {
          OR: [
            { location: { contains: query, mode: "insensitive" } },
            { company: { contains: query, mode: "insensitive" } },
            { title: { contains: query, mode: "insensitive" } },
            { roleFamily: { contains: query, mode: "insensitive" } },
          ],
        },
      },
    },
    {
      tags: {
        some: {
          tag: {
            userId,
            name: { contains: query, mode: "insensitive" },
          },
        },
      },
    },
    {
      events: {
        some: {
          type: "REMINDER",
          note: { contains: query, mode: "insensitive" },
        },
      },
    },
  ];

  if (matchedStatuses.length > 0) {
    clauses.push({ status: { in: matchedStatuses } });
  }

  return { OR: clauses };
}

function buildTrackedSearchWhere(
  search: string,
  userId: string,
  scope: TrackerSearchScope = "all"
): Prisma.TrackedApplicationWhereInput | null {
  const query = search.trim().slice(0, 120);
  if (!query) return null;

  if (scope !== "all") {
    return buildScopedTrackedSearchWhere(query, userId, scope);
  }

  const tokenConditions = buildTrackedSearchTokens(query).map((token) =>
    buildTrackedAllSearchTokenWhere(token, userId)
  );

  if (tokenConditions.length === 0) return null;
  return tokenConditions.length === 1 ? tokenConditions[0] : { AND: tokenConditions };
}

function buildScopedTrackedSearchWhere(
  query: string,
  userId: string,
  scope: Exclude<TrackerSearchScope, "all">
): Prisma.TrackedApplicationWhereInput {
  switch (scope) {
    case "title":
      return {
        OR: [
          { roleTitle: { contains: query, mode: "insensitive" } },
          { canonicalJob: { is: { title: { contains: query, mode: "insensitive" } } } },
        ],
      };
    case "company":
      return {
        OR: [
          { company: { contains: query, mode: "insensitive" } },
          { canonicalJob: { is: { company: { contains: query, mode: "insensitive" } } } },
        ],
      };
    case "location":
      return {
        canonicalJob: {
          is: {
            location: { contains: query, mode: "insensitive" },
          },
        },
      };
    case "tag":
      return {
        tags: {
          some: {
            tag: {
              userId,
              name: { contains: query, mode: "insensitive" },
            },
          },
        },
      };
    case "reminder":
      return {
        events: {
          some: {
            type: "REMINDER",
            note: { contains: query, mode: "insensitive" },
          },
        },
      };
  }
}

export async function getTrackedDashboardData(input: {
  status?: TrackedApplicationStatus | "ALL";
  deadline?: TrackerDeadlineFilter;
  sort?: TrackerSortFilter;
  tags?: string[];
  search?: string;
  searchScope?: TrackerSearchScope;
  titleSearch?: string;
  companySearch?: string;
  locationSearch?: string;
  tagSearch?: string;
  reminderSearch?: string;
}) {
  const userId = await requireCurrentAuthUserId();
  const status = input.status ?? "ALL";
  const deadline = input.deadline ?? "ALL";
  const tags = normalizeTagNames(input.tags ?? []);
  const where: Prisma.TrackedApplicationWhereInput = {
    userId,
  };

  if (status !== "ALL") {
    where.status = status;
  }

  const today = startOfUtcDay(new Date());
  if (deadline === "UPCOMING") {
    where.deadline = { gte: today };
  } else if (deadline === "OVERDUE") {
    where.deadline = { lt: today };
  } else if (deadline === "NO_DEADLINE") {
    where.deadline = null;
  }

  if (tags.length > 0) {
    for (const name of tags) {
      appendTrackedAndCondition(where, {
        tags: {
          some: {
            tag: {
              name,
              userId,
            },
          },
        },
      });
    }
  }

  const searchWhere = buildTrackedSearchWhere(input.search ?? "", userId, input.searchScope ?? "all");
  if (searchWhere) {
    appendTrackedAndCondition(where, searchWhere);
  }
  const scopedSearches: Array<[Exclude<TrackerSearchScope, "all">, string | undefined]> = [
    ["title", input.titleSearch],
    ["company", input.companySearch],
    ["location", input.locationSearch],
    ["tag", input.tagSearch],
    ["reminder", input.reminderSearch],
  ];
  for (const [scope, value] of scopedSearches) {
    const scopedWhere = buildTrackedSearchWhere(value ?? "", userId, scope);
    if (scopedWhere) {
      appendTrackedAndCondition(where, scopedWhere);
    }
  }

  const orderBy = buildTrackedOrderBy(input.sort ?? "UPDATED_DESC");

  const [applications, totalApplicationCount, activeCount, unreadNotificationCount, userTags] =
    await Promise.all([
      prisma.trackedApplication.findMany({
        where,
        select: {
          id: true,
          canonicalJobId: true,
          company: true,
          roleTitle: true,
          roleUrl: true,
          status: true,
          deadline: true,
          notes: true,
          updatedAt: true,
          canonicalJob: {
            select: {
              id: true,
              status: true,
              location: true,
              workMode: true,
            },
          },
          tags: {
            orderBy: {
              tag: {
                name: "asc",
              },
            },
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          events: {
            where: { type: "REMINDER" },
            orderBy: [
              { reminderAt: { sort: "asc", nulls: "last" } },
              { timestamp: "desc" },
            ],
            select: {
              id: true,
              type: true,
              timestamp: true,
              note: true,
              reminderAt: true,
              reminderNotifiedAt: true,
            },
          },
        },
        orderBy,
      }),
      prisma.trackedApplication.count({
        where: { userId },
      }),
      prisma.trackedApplication.count({
        where: {
          userId,
          status: {
            in: TRACKED_ACTIVE_STATUSES,
          },
        },
      }),
      prisma.notification.count({
        where: { userId, readAt: null },
      }),
      prisma.tag.findMany({
        where: {
          userId,
          applications: {
            some: {},
          },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  return {
    applications,
    totalApplicationCount,
    activeCount,
    unreadNotificationCount,
    userTags,
    selectedTags: tags,
    loadedAt: new Date(),
  };
}

export async function getTrackedApplicationWorkspace(id: string) {
  const [authUserId, profileId] = await Promise.all([
    requireCurrentAuthUserId(),
    requireCurrentProfileId(),
  ]);

  const [application, unreadNotificationCount, userDocuments, generatedDocuments, userTags] =
    await Promise.all([
      prisma.trackedApplication.findFirst({
        where: { id, userId: authUserId },
        select: {
          id: true,
          company: true,
          roleTitle: true,
          roleUrl: true,
          status: true,
          deadline: true,
          jobDescription: true,
          fitAnalysis: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          canonicalJob: {
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              workMode: true,
              status: true,
              applyUrl: true,
              deadline: true,
            },
          },
          events: {
            orderBy: { timestamp: "desc" },
            select: {
              id: true,
              type: true,
              timestamp: true,
              note: true,
              reminderAt: true,
              reminderNotifiedAt: true,
            },
          },
          documentLinks: {
            orderBy: { slot: "asc" },
            select: {
              id: true,
              slot: true,
              document: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  isAiGenerated: true,
                  isPrimary: true,
                  analysis: {
                    select: {
                      documentId: true,
                    },
                  },
                },
              },
            },
          },
          tags: {
            orderBy: {
              tag: {
                name: "asc",
              },
            },
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
      prisma.notification.count({
        where: { userId: authUserId, readAt: null },
      }),
      prisma.document.findMany({
        where: { userId: profileId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          type: true,
          isAiGenerated: true,
          isPrimary: true,
          analysis: {
            select: {
              documentId: true,
            },
          },
        },
      }),
      prisma.document.findMany({
        where: {
          userId: profileId,
          isAiGenerated: true,
          sourceApplicationId: id,
          type: {
            in: ["RESUME", "COVER_LETTER"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          type: true,
          filename: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          extractedText: true,
          createdAt: true,
        },
      }),
      prisma.tag.findMany({
        where: {
          userId: authUserId,
          applications: {
            some: {},
          },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  return {
    application,
    unreadNotificationCount,
    userDocuments,
    generatedDocuments,
    userTags,
  };
}

export async function getNotificationCenterData() {
  const userId = await requireCurrentAuthUserId();

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        trackedApplicationId: true,
        title: true,
        message: true,
        createdAt: true,
        readAt: true,
        trackedApplication: {
          select: {
            id: true,
            canonicalJobId: true,
            company: true,
            roleTitle: true,
          },
        },
      },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  return {
    notifications,
    unreadCount,
  };
}

export async function getTrackerSettingsData() {
  const userId = await requireCurrentAuthUserId();

  const [user, profile, unreadNotificationCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        emailNotificationsEnabled: true,
        emailVerified: true,
        name: true,
        image: true,
        createdAt: true,
      },
    }),
    prisma.userProfile.findUnique({
      where: { authUserId: userId },
      select: {
        id: true,
        phone: true,
        location: true,
        headline: true,
        linkedinUrl: true,
        githubUrl: true,
        portfolioUrl: true,
        workAuthorization: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        preferredWorkMode: true,
        experienceLevel: true,
        automationMode: true,
      },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  return {
    user,
    profile,
    unreadNotificationCount,
  };
}

export async function getComparableDocuments() {
  const [authUserId, profileId] = await Promise.all([
    requireCurrentAuthUserId(),
    requireCurrentProfileId(),
  ]);

  const [documents, unreadNotificationCount] = await Promise.all([
    prisma.document.findMany({
      where: { userId: profileId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        filename: true,
        type: true,
        extractedText: true,
      },
    }),
    prisma.notification.count({
      where: { userId: authUserId, readAt: null },
    }),
  ]);

  return {
    documents,
    unreadNotificationCount,
  };
}

export async function getComparableDocumentText(documentId: string) {
  const profileId = await requireCurrentProfileId();
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      userId: profileId,
    },
    select: {
      extractedText: true,
    },
  });

  if (!document) {
    return { text: null, error: "Document not found." };
  }

  if (!document.extractedText?.trim()) {
    return {
      text: null,
      error: "This document has no extracted text. Re-upload or parse it first.",
    };
  }

  return {
    text: document.extractedText,
    error: null,
  };
}

export async function createTrackedApplication(input: {
  company: string;
  roleTitle: string;
  roleUrl?: string | null;
  status?: TrackedApplicationStatus;
  deadline?: Date | null;
  notes?: string | null;
  initialReminderNote?: string | null;
  initialReminderAt?: Date | null;
}) {
  const userId = await requireCurrentAuthUserId();
  const status = input.status ?? "WISHLIST";
  const initialReminderNote = input.initialReminderNote?.trim() ?? "";

  const created = await prisma.trackedApplication.create({
    data: {
      userId,
      company: input.company.trim(),
      roleTitle: input.roleTitle.trim(),
      roleUrl: normalizeOptionalUrl(input.roleUrl),
      status,
      deadline: input.deadline ?? null,
      notes: input.notes?.trim() || null,
    },
  });

  await prisma.trackedApplicationEvent.create({
    data: {
      trackedApplicationId: created.id,
      type: statusToEventType(status),
      note:
        status === "WISHLIST"
          ? "Application created."
          : `Application created with status ${status.toLowerCase()}.`,
    },
  });

  if (initialReminderNote) {
    await prisma.trackedApplicationEvent.create({
      data: {
        trackedApplicationId: created.id,
        type: "REMINDER",
        note: initialReminderNote,
        reminderAt: input.initialReminderAt ?? null,
      },
    });
  }

  queueReminderCheck(created.id);
  return created;
}

const TRACKED_STATUS_NOTE: Record<TrackedApplicationStatus, string> = {
  WISHLIST: "wishlist",
  PREPARING: "preparing",
  APPLIED: "applied",
  SCREEN: "screen",
  INTERVIEW: "interview",
  OFFER: "offer",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
};

export async function upsertTrackedApplicationFromJob(input: {
  canonicalJobId: string;
  status: TrackedApplicationStatus;
}) {
  const [authUserId, profileId] = await Promise.all([
    requireCurrentAuthUserId(),
    requireCurrentProfileId(),
  ]);

  const [existing, job] = await Promise.all([
    prisma.trackedApplication.findUnique({
      where: {
        userId_canonicalJobId: {
          userId: authUserId,
          canonicalJobId: input.canonicalJobId,
        },
      },
      select: {
        id: true,
        status: true,
        notes: true,
        fitAnalysis: true,
        jobDescription: true,
      },
    }),
    prisma.jobCanonical.findUnique({
      where: { id: input.canonicalJobId },
      select: {
        id: true,
        company: true,
        title: true,
        applyUrl: true,
        deadline: true,
        description: true,
        applicationPackages: {
          where: { userId: profileId },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            whyItMatches: true,
            resumeVariant: {
              select: {
                documentId: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!job) {
    throw new Error("Job not found");
  }

  const latestPackage = job.applicationPackages[0] ?? null;
  const normalizedJobDescription = getNormalizedTrackedJobDescription(job.description);
  const nextStatus = resolveTrackedStatusFromJobUpsert(existing?.status, input.status);
  const tracked = existing
    ? await prisma.trackedApplication.update({
        where: { id: existing.id },
        data: {
          company: job.company,
          roleTitle: job.title,
          roleUrl: job.applyUrl,
          deadline: job.deadline,
          status: nextStatus,
          jobDescription: existing.jobDescription ?? normalizedJobDescription,
          fitAnalysis: existing.fitAnalysis ?? latestPackage?.whyItMatches ?? null,
        },
      })
    : await prisma.trackedApplication.create({
        data: {
          userId: authUserId,
          canonicalJobId: job.id,
          company: job.company,
          roleTitle: job.title,
          roleUrl: job.applyUrl,
          status: input.status,
          deadline: job.deadline,
          jobDescription: normalizedJobDescription,
          fitAnalysis: latestPackage?.whyItMatches ?? null,
        },
      });

  await prisma.trackedApplicationEvent.create({
    data: {
      trackedApplicationId: tracked.id,
      type: statusToEventType(nextStatus),
      note: existing
        ? existing.status === nextStatus
          ? `Application refreshed from the jobs feed as ${TRACKED_STATUS_NOTE[nextStatus]}.`
          : `Status updated from the jobs feed to ${TRACKED_STATUS_NOTE[nextStatus]}.`
        : nextStatus === "WISHLIST"
          ? "Application created from the jobs feed."
          : `Application created from the jobs feed as ${TRACKED_STATUS_NOTE[nextStatus]}.`,
    },
  });

  const resumeDocumentId = latestPackage?.resumeVariant.documentId;
  await upsertTrackedApplicationResumeDocument({
    applicationId: tracked.id,
    profileId,
    documentId: resumeDocumentId,
  });

  queueReminderCheck(tracked.id);
  return {
    applicationId: tracked.id,
    created: !existing,
    status: nextStatus,
  };
}

// Fields the user can edit on the application detail page. `notes`,
// `jobDescription`, `fitAnalysis` are free-form text and may be cleared
// (treated as null when blank). `company` and `roleTitle` are identity
// fields and cannot be blank. `roleUrl` is optional but must look like a URL
// when provided.
export type EditableTrackedApplicationField =
  | "notes"
  | "jobDescription"
  | "fitAnalysis"
  | "company"
  | "roleTitle"
  | "roleUrl";

const NULLABLE_TRACKED_FIELDS = new Set<EditableTrackedApplicationField>([
  "notes",
  "jobDescription",
  "fitAnalysis",
  "roleUrl",
]);

const REQUIRED_TRACKED_FIELDS = new Set<EditableTrackedApplicationField>([
  "company",
  "roleTitle",
]);

export async function updateTrackedApplicationField(input: {
  applicationId: string;
  field: EditableTrackedApplicationField;
  value?: string | null;
}) {
  const userId = await requireCurrentAuthUserId();

  const trimmed = input.value?.trim() ?? "";
  const isEmpty = trimmed.length === 0;

  if (isEmpty && REQUIRED_TRACKED_FIELDS.has(input.field)) {
    throw new Error(`${input.field} cannot be empty.`);
  }

  if (input.field === "roleUrl" && !isEmpty) {
    // Lightweight URL validation — accept http(s) only; reject obvious junk.
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      throw new Error("Job link must start with http:// or https://");
    }
  }

  // Cap text length to avoid pathological inputs blowing the row.
  if (input.field === "company" && trimmed.length > 200) {
    throw new Error("Company name is too long (max 200 chars).");
  }
  if (input.field === "roleTitle" && trimmed.length > 300) {
    throw new Error("Job title is too long (max 300 chars).");
  }
  if (input.field === "roleUrl" && trimmed.length > 2000) {
    throw new Error("Job link is too long (max 2000 chars).");
  }

  const nextValue = NULLABLE_TRACKED_FIELDS.has(input.field)
    ? (isEmpty ? null : trimmed)
    : trimmed;

  const result = await prisma.trackedApplication.updateMany({
    where: {
      id: input.applicationId,
      userId,
    },
    data: {
      [input.field]: nextValue,
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new Error("Tracked application not found");
  }
}

export async function updateTrackedApplicationStatus(input: {
  applicationId: string;
  status: TrackedApplicationStatus;
}) {
  const userId = await requireCurrentAuthUserId();
  const existing = await prisma.trackedApplication.findFirst({
    where: {
      id: input.applicationId,
      userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!existing) {
    throw new Error("Tracked application not found");
  }

  if (existing.status === input.status) {
    return { changed: false };
  }

  await prisma.$transaction([
    prisma.trackedApplication.update({
      where: { id: input.applicationId },
      data: {
        status: input.status,
        updatedAt: new Date(),
      },
    }),
    prisma.trackedApplicationEvent.create({
      data: {
        trackedApplicationId: input.applicationId,
        type: statusToEventType(input.status),
        note: `Status updated to ${TRACKED_STATUS_NOTE[input.status]}.`,
      },
    }),
  ]);

  queueReminderCheck(input.applicationId);
  return { changed: true };
}

export async function addTrackedApplicationEvent(input: {
  applicationId: string;
  type: TrackedApplicationEventType;
  note?: string | null;
  reminderAt?: Date | null;
}) {
  const userId = await requireCurrentAuthUserId();
  const application = await prisma.trackedApplication.findFirst({
    where: {
      id: input.applicationId,
      userId,
    },
    select: { id: true },
  });

  if (!application) {
    throw new Error("Tracked application not found");
  }

  const mappedStatus: Partial<Record<TrackedApplicationEventType, TrackedApplicationStatus>> = {
    APPLIED: "APPLIED",
    SCREEN: "SCREEN",
    INTERVIEW: "INTERVIEW",
    OFFER: "OFFER",
    REJECTED: "REJECTED",
  };

  await prisma.$transaction([
    prisma.trackedApplicationEvent.create({
      data: {
        trackedApplicationId: input.applicationId,
        type: input.type,
        note: input.note?.trim() || null,
        reminderAt: input.reminderAt ?? null,
      },
    }),
    prisma.trackedApplication.update({
      where: { id: input.applicationId },
      data: {
        updatedAt: new Date(),
        ...(mappedStatus[input.type] ? { status: mappedStatus[input.type] } : {}),
      },
    }),
  ]);
}

export async function updateTrackedApplicationEvent(input: {
  applicationId: string;
  eventId: string;
  note?: string | null;
  reminderAt?: Date | null;
}) {
  const userId = await requireCurrentAuthUserId();
  const event = await prisma.trackedApplicationEvent.findFirst({
    where: {
      id: input.eventId,
      trackedApplication: {
        id: input.applicationId,
        userId,
      },
    },
    select: {
      id: true,
      type: true,
      reminderAt: true,
      reminderNotifiedAt: true,
    },
  });

  if (!event) {
    throw new Error("Timeline event not found");
  }

  if (event.type !== "REMINDER") {
    throw new Error("Only reminders can be edited here.");
  }

  const note = input.note?.trim() ?? "";
  if (!note) {
    throw new Error("Reminder text is required.");
  }

  const nextReminderAt = input.reminderAt ?? null;
  const reminderChanged =
    (event.reminderAt?.getTime() ?? null) !== (nextReminderAt?.getTime() ?? null);

  await prisma.$transaction([
    prisma.trackedApplicationEvent.update({
      where: { id: event.id },
      data: {
        note,
        reminderAt: nextReminderAt,
        reminderNotifiedAt: reminderChanged ? null : event.reminderNotifiedAt,
      },
    }),
    prisma.trackedApplication.update({
      where: { id: input.applicationId },
      data: { updatedAt: new Date() },
    }),
  ]);
}

export async function deleteTrackedApplicationEvent(input: {
  applicationId: string;
  eventId: string;
}) {
  const userId = await requireCurrentAuthUserId();
  const event = await prisma.trackedApplicationEvent.findFirst({
    where: {
      id: input.eventId,
      trackedApplication: {
        id: input.applicationId,
        userId,
      },
    },
    select: { id: true },
  });

  if (!event) {
    throw new Error("Timeline event not found");
  }

  await prisma.$transaction([
    prisma.trackedApplicationEvent.delete({
      where: { id: input.eventId },
    }),
    prisma.trackedApplication.update({
      where: { id: input.applicationId },
      data: { updatedAt: new Date() },
    }),
  ]);
}

export async function deleteTrackedApplication(input: { applicationId: string }) {
  const [authUserId, profileId] = await Promise.all([
    requireCurrentAuthUserId(),
    requireCurrentProfileId(),
  ]);

  const application = await prisma.trackedApplication.findFirst({
    where: {
      id: input.applicationId,
      userId: authUserId,
    },
    select: {
      id: true,
      canonicalJobId: true,
      status: true,
      tags: {
        select: {
          tagId: true,
        },
      },
    },
  });

  if (!application) {
    throw new Error("Tracked application not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.trackedApplication.delete({
      where: { id: input.applicationId },
    });

    if (
      application.canonicalJobId &&
      (application.status === "WISHLIST" || application.status === "PREPARING")
    ) {
      await tx.savedJob.deleteMany({
        where: {
          userId: profileId,
          canonicalJobId: application.canonicalJobId,
          status: "ACTIVE",
        },
      });
    }

    for (const { tagId } of application.tags) {
      const remainingUsageCount = await tx.trackedApplicationTag.count({
        where: { tagId },
      });

      if (remainingUsageCount === 0) {
        await tx.tag.deleteMany({
          where: {
            id: tagId,
            userId: authUserId,
          },
        });
      }
    }
  });

  return {
    canonicalJobId: application.canonicalJobId,
    status: application.status,
  };
}

export async function removeTrackedWishlistFromJob(canonicalJobId: string) {
  const userId = await requireCurrentAuthUserId();

  return prisma.trackedApplication.deleteMany({
    where: {
      userId,
      canonicalJobId,
      status: "WISHLIST",
    },
  });
}

export async function addTrackedApplicationTag(input: {
  applicationId: string;
  name: string;
}) {
  const userId = await requireCurrentAuthUserId();
  const application = await prisma.trackedApplication.findFirst({
    where: {
      id: input.applicationId,
      userId,
    },
    select: {
      id: true,
    },
  });

  if (!application) {
    throw new Error("Tracked application not found");
  }

  const [name] = normalizeTagNames([input.name]);
  if (!name) {
    throw new Error("Tag name is required.");
  }

  const tag = await prisma.tag.upsert({
    where: {
      userId_name: {
        userId,
        name,
      },
    },
    update: {},
    create: {
      userId,
      name,
    },
    select: {
      id: true,
    },
  });

  await prisma.$transaction([
    prisma.trackedApplicationTag.createMany({
      data: [{ trackedApplicationId: input.applicationId, tagId: tag.id }],
      skipDuplicates: true,
    }),
    prisma.trackedApplication.update({
      where: { id: input.applicationId },
      data: { updatedAt: new Date() },
    }),
  ]);

  return { name };
}

export async function removeTrackedApplicationTag(input: {
  applicationId: string;
  tagId: string;
}) {
  const userId = await requireCurrentAuthUserId();
  const application = await prisma.trackedApplication.findFirst({
    where: {
      id: input.applicationId,
      userId,
    },
    select: {
      id: true,
    },
  });

  if (!application) {
    throw new Error("Tracked application not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.trackedApplicationTag.deleteMany({
      where: {
        trackedApplicationId: input.applicationId,
        tagId: input.tagId,
      },
    });

    await tx.trackedApplication.update({
      where: { id: input.applicationId },
      data: { updatedAt: new Date() },
    });

    const remainingUsageCount = await tx.trackedApplicationTag.count({
      where: {
        tagId: input.tagId,
      },
    });

    if (remainingUsageCount === 0) {
      await tx.tag.deleteMany({
        where: {
          id: input.tagId,
          userId,
        },
      });
    }
  });
}

export async function linkTrackedApplicationDocument(input: {
  applicationId: string;
  documentId: string;
  slot: TrackedApplicationDocumentSlot;
}) {
  const [authUserId, profileId] = await Promise.all([
    requireCurrentAuthUserId(),
    requireCurrentProfileId(),
  ]);

  const [application, document] = await Promise.all([
    prisma.trackedApplication.findFirst({
      where: { id: input.applicationId, userId: authUserId },
      select: { id: true },
    }),
    prisma.document.findFirst({
      where: { id: input.documentId, userId: profileId },
      select: { id: true, type: true },
    }),
  ]);

  if (!application) {
    throw new Error("Tracked application not found");
  }

  if (!document) {
    throw new Error("Document not found");
  }

  if (!isDocumentTypeCompatibleWithSlot(input.slot, document.type)) {
    throw new Error(getIncompatibleDocumentTypeMessage(input.slot));
  }

  await prisma.$transaction([
    prisma.trackedApplicationDocument.upsert({
      where: {
        trackedApplicationId_slot: {
          trackedApplicationId: input.applicationId,
          slot: input.slot,
        },
      },
      create: {
        trackedApplicationId: input.applicationId,
        documentId: input.documentId,
        slot: input.slot,
      },
      update: {
        documentId: input.documentId,
      },
    }),
    prisma.trackedApplication.update({
      where: { id: input.applicationId },
      data: { updatedAt: new Date() },
    }),
  ]);
}

export async function unlinkTrackedApplicationDocument(input: {
  applicationId: string;
  slot: TrackedApplicationDocumentSlot;
}) {
  const userId = await requireCurrentAuthUserId();
  const application = await prisma.trackedApplication.findFirst({
    where: {
      id: input.applicationId,
      userId,
    },
    select: { id: true },
  });

  if (!application) {
    throw new Error("Tracked application not found");
  }

  await prisma.$transaction([
    prisma.trackedApplicationDocument.deleteMany({
      where: {
        trackedApplicationId: input.applicationId,
        slot: input.slot,
      },
    }),
    prisma.trackedApplication.update({
      where: { id: input.applicationId },
      data: { updatedAt: new Date() },
    }),
  ]);
}

export async function markNotificationRead(notificationId: string) {
  const userId = await requireCurrentAuthUserId();
  await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
}

export async function markAllNotificationsRead() {
  const userId = await requireCurrentAuthUserId();
  await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
}

type AutomationModeInput =
  | "DISCOVERY_ONLY"
  | "ASSIST"
  | "REVIEW_BEFORE_SUBMIT"
  | "STRICT_AUTO_APPLY";

type WorkModeInput = "REMOTE" | "HYBRID" | "ONSITE" | "FLEXIBLE" | "UNKNOWN";

type ExperienceLevelInput =
  | "ENTRY"
  | "MID"
  | "SENIOR"
  | "LEAD"
  | "EXECUTIVE"
  | "UNKNOWN";

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : null;
}

function cleanOptionalUrl(value: string | null | undefined): string | null {
  const trimmed = cleanOptional(value);
  if (!trimmed) return null;
  try {
    return normalizeOptionalUrl(trimmed);
  } catch {
    return null;
  }
}

export async function saveTrackerSettings(input: {
  emailNotificationsEnabled?: boolean;
  name?: string | null;
  automationMode?: AutomationModeInput | null;
  preferredWorkMode?: WorkModeInput | null;
  experienceLevel?: ExperienceLevelInput | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  phone?: string | null;
  location?: string | null;
  headline?: string | null;
  workAuthorization?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
}) {
  const userId = await requireCurrentAuthUserId();

  const userData: Prisma.UserUpdateInput = {};
  if (typeof input.emailNotificationsEnabled === "boolean") {
    userData.emailNotificationsEnabled = input.emailNotificationsEnabled;
  }
  if (typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (trimmed.length) {
      userData.name = trimmed;
    }
  }

  const profileData: Prisma.UserProfileUpdateInput = {};
  if (typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (trimmed.length) {
      profileData.name = trimmed;
    }
  }
  if (input.automationMode !== undefined) {
    profileData.automationMode = input.automationMode ?? "REVIEW_BEFORE_SUBMIT";
  }
  if (input.preferredWorkMode !== undefined) {
    profileData.preferredWorkMode = input.preferredWorkMode ?? null;
  }
  if (input.experienceLevel !== undefined) {
    profileData.experienceLevel = input.experienceLevel ?? null;
  }
  if (input.salaryMin !== undefined) {
    profileData.salaryMin =
      typeof input.salaryMin === "number" && Number.isFinite(input.salaryMin)
        ? Math.max(0, Math.round(input.salaryMin))
        : null;
  }
  if (input.salaryMax !== undefined) {
    profileData.salaryMax =
      typeof input.salaryMax === "number" && Number.isFinite(input.salaryMax)
        ? Math.max(0, Math.round(input.salaryMax))
        : null;
  }
  if (input.salaryCurrency !== undefined) {
    profileData.salaryCurrency =
      cleanOptional(input.salaryCurrency)?.toUpperCase().slice(0, 3) ?? "USD";
  }
  if (input.phone !== undefined) {
    profileData.phone = cleanOptional(input.phone);
  }
  if (input.location !== undefined) {
    profileData.location = cleanOptional(input.location);
  }
  if (input.headline !== undefined) {
    profileData.headline = cleanOptional(input.headline);
  }
  if (input.workAuthorization !== undefined) {
    profileData.workAuthorization = cleanOptional(input.workAuthorization);
  }
  if (input.linkedinUrl !== undefined) {
    profileData.linkedinUrl = cleanOptionalUrl(input.linkedinUrl);
  }
  if (input.githubUrl !== undefined) {
    profileData.githubUrl = cleanOptionalUrl(input.githubUrl);
  }
  if (input.portfolioUrl !== undefined) {
    profileData.portfolioUrl = cleanOptionalUrl(input.portfolioUrl);
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length > 0) {
      await tx.user.update({
        where: { id: userId },
        data: userData,
      });
    }
    if (Object.keys(profileData).length > 0) {
      await tx.userProfile.updateMany({
        where: { authUserId: userId },
        data: profileData,
      });
    }
  });
}

export async function syncTrackedApplicationFromSubmission(canonicalJobId: string) {
  const [authUserId, profileId] = await Promise.all([
    requireCurrentAuthUserId(),
    requireCurrentProfileId(),
  ]);

  const [existing, job] = await Promise.all([
    prisma.trackedApplication.findUnique({
      where: {
        userId_canonicalJobId: {
          userId: authUserId,
          canonicalJobId,
        },
      },
      select: {
        id: true,
        status: true,
        notes: true,
        fitAnalysis: true,
        jobDescription: true,
      },
    }),
    prisma.jobCanonical.findUnique({
      where: { id: canonicalJobId },
      select: {
        id: true,
        company: true,
        title: true,
        applyUrl: true,
        deadline: true,
        description: true,
        applicationPackages: {
          where: { userId: profileId },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            whyItMatches: true,
            resumeVariant: {
              select: {
                documentId: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!job) {
    throw new Error("Job not found");
  }

  const latestPackage = job.applicationPackages[0] ?? null;
  const normalizedJobDescription = getNormalizedTrackedJobDescription(job.description);
  const nextStatus: TrackedApplicationStatus =
    existing?.status === "WISHLIST" || existing?.status === "PREPARING" || !existing
      ? "APPLIED"
      : existing.status;

  const tracked = existing
    ? await prisma.trackedApplication.update({
        where: { id: existing.id },
        data: {
          company: job.company,
          roleTitle: job.title,
          roleUrl: job.applyUrl,
          deadline: job.deadline,
          status: nextStatus,
          jobDescription: existing.jobDescription ?? normalizedJobDescription,
          fitAnalysis: existing.fitAnalysis ?? latestPackage?.whyItMatches ?? null,
        },
      })
    : await prisma.trackedApplication.create({
        data: {
          userId: authUserId,
          canonicalJobId: job.id,
          company: job.company,
          roleTitle: job.title,
          roleUrl: job.applyUrl,
          status: "APPLIED",
          deadline: job.deadline,
          jobDescription: normalizedJobDescription,
          fitAnalysis: latestPackage?.whyItMatches ?? null,
        },
      });

  if (!existing || existing.status === "WISHLIST" || existing.status === "PREPARING") {
    await prisma.trackedApplicationEvent.create({
      data: {
        trackedApplicationId: tracked.id,
        type: "APPLIED",
        note: !existing
          ? "Created automatically from the jobs apply flow."
          : "Marked applied from the jobs apply flow.",
      },
    });
  }

  const resumeDocumentId = latestPackage?.resumeVariant.documentId;
  await upsertTrackedApplicationResumeDocument({
    applicationId: tracked.id,
    profileId,
    documentId: resumeDocumentId,
  });

  queueReminderCheck(tracked.id);
  return tracked;
}

export async function syncTrackedApplicationLifecycleFromSubmission(input: {
  canonicalJobId: string;
  submissionStatus: "CONFIRMED" | "FAILED" | "WITHDRAWN";
}) {
  const userId = await requireCurrentAuthUserId();
  const existing = await prisma.trackedApplication.findUnique({
    where: {
      userId_canonicalJobId: {
        userId,
        canonicalJobId: input.canonicalJobId,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!existing) {
    return null;
  }

  if (input.submissionStatus === "WITHDRAWN") {
    if (existing.status !== "WITHDRAWN") {
      await prisma.$transaction([
        prisma.trackedApplication.update({
          where: { id: existing.id },
          data: { status: "WITHDRAWN" },
        }),
        prisma.trackedApplicationEvent.create({
          data: {
            trackedApplicationId: existing.id,
            type: "NOTE",
            note: "Withdrawn from the jobs apply flow.",
          },
        }),
      ]);
    }
    return "WITHDRAWN";
  }

  if (input.submissionStatus === "FAILED") {
    await prisma.trackedApplicationEvent.create({
      data: {
        trackedApplicationId: existing.id,
        type: "NOTE",
        note: "Submission marked failed in the jobs apply flow.",
      },
    });
    return existing.status;
  }

  await prisma.trackedApplicationEvent.create({
    data: {
      trackedApplicationId: existing.id,
      type: "NOTE",
      note: "Submission confirmed in the jobs apply flow.",
    },
  });
  return existing.status;
}
