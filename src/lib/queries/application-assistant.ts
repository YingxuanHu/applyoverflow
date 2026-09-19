import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { isSessionUsableByPolicy } from "@/lib/auth-session-policy";
import {
  normalizeContact,
  normalizeExperiences,
  normalizeEducations,
} from "@/lib/profile";
import { historyDateText } from "@/lib/profile-history";
import { enqueueDurableTopPicksRefresh } from "@/lib/top-picks/refresh-queue";
import { buildApplicationProfileReference } from "@/lib/application-profile-reference";
import { normalizeUrlIdentityKey } from "@/lib/ingestion/source-quality";
import {
  ANSWER_LIBRARY_KEY,
  allowedExtension,
  captureSchema,
  exchangeSchema,
  extensionRequestSchema,
  applicationContext,
  sameApplication,
  mergeCapturedQuestions,
  parseAnswerLibrary,
  parseAssistantState,
  questionKind,
  reviewSaveSchema,
  appliedConfirmationSchema,
  historySelectionSchema,
} from "@/lib/application-assistant";
import { decideAnswerReuse } from "@/lib/application-answer-policy";

export class AssistantError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const hashSecret = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

// Caller must come from requireFreshSensitiveSession, never request-supplied IDs.
export async function authorizeExtension(
  identity: { authUserId: string; sessionId: string },
  raw: unknown,
) {
  const input = extensionRequestSchema.parse(raw);
  if (!allowedExtension(input.clientId))
    throw new AssistantError("This extension is not enabled.", 403);
  const code = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${identity.authUserId} FOR UPDATE`;
    await tx.extensionConnection.deleteMany({
      where: { userId: identity.authUserId, expiresAt: { lte: new Date() } },
    });
    const count = await tx.extensionConnection.count({
      where: { userId: identity.authUserId },
    });
    if (count >= 5)
      throw new AssistantError(
        "Disconnect an existing extension in Settings first.",
      );
    await tx.extensionConnection.create({
      data: {
        userId: identity.authUserId,
        sessionId: identity.sessionId,
        clientId: input.clientId,
        challenge: input.challenge,
        codeHash: hashSecret(code),
        expiresAt: new Date(Date.now() + 120_000),
      },
    });
  });
  return code;
}

export async function exchangeExtensionCode(raw: unknown) {
  const input = exchangeSchema.parse(raw);
  if (!allowedExtension(input.clientId))
    throw new AssistantError("Invalid connection request.", 401);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
  const email = await prisma.$transaction(async (tx) => {
    const grant = await tx.extensionConnection.findUnique({
      where: { codeHash: hashSecret(input.code) },
      include: {
        session: true,
        user: { select: { status: true, email: true } },
      },
    });
    if (
      !grant ||
      grant.clientId !== input.clientId ||
      grant.challenge !== hashSecret(input.verifier) ||
      grant.expiresAt <= new Date() ||
      grant.user.status !== "ACTIVE" ||
      !isSessionUsableByPolicy(grant.session)
    )
      throw new AssistantError(
        "Connection expired or invalid. Connect again.",
        401,
      );
    const consumed = await tx.extensionConnection.updateMany({
      where: {
        id: grant.id,
        codeHash: grant.codeHash,
        tokenHash: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        codeHash: null,
        tokenHash: hashSecret(token),
        connectedAt: new Date(),
        expiresAt,
      },
    });
    if (consumed.count !== 1)
      throw new AssistantError("Connection code already used.", 401);
    return grant.user.email;
  });
  return { token, expiresAt: expiresAt.toISOString(), email };
}

export async function authenticateExtension(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new AssistantError("Connect the extension first.", 401);
  const grant = await prisma.extensionConnection.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { session: true, user: { select: { status: true } } },
  });
  if (
    !grant ||
    !allowedExtension(grant.clientId) ||
    !grant.connectedAt ||
    grant.expiresAt <= new Date() ||
    grant.user.status !== "ACTIVE" ||
    !isSessionUsableByPolicy(grant.session)
  )
    throw new AssistantError("Connection expired. Connect again.", 401);
  return { userId: grant.userId, connectionId: grant.id };
}

export async function getExtensionContact(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { authUserId: userId },
    select: { contactJson: true },
  });
  if (!profile)
    throw new AssistantError("Complete your profile in ApplyOverflow first.");
  const contact = normalizeContact(profile.contactJson);
  // Never export work authorization, demographics, resume contents, or the whole profile.
  return {
    fullName: contact.fullName,
    givenName: contact.givenName ?? "",
    familyName: contact.familyName ?? "",
    email: contact.email,
    phone: contact.phone,
    linkedInUrl: contact.linkedInUrl,
    githubUrl: contact.githubUrl,
    portfolioUrl: contact.portfolioUrl,
    streetAddress: contact.streetAddress ?? "",
    addressLine2: contact.addressLine2 ?? "",
    city: contact.city ?? "",
    postalCode: contact.postalCode ?? "",
  };
}

export async function getExtensionHistory(userId: string, selection?: unknown) {
  const selected =
    selection === undefined ? null : historySelectionSchema.parse(selection);
  const profile = await prisma.userProfile.findUnique({
    where: { authUserId: userId },
    select: { experiencesJson: true, educationsJson: true, updatedAt: true },
  });
  if (!profile) throw new AssistantError("Complete your profile first.");
  const revision = profile.updatedAt.toISOString();
  const groups = {
    experience: normalizeExperiences(profile.experiencesJson).slice(0, 50),
    education: normalizeEducations(profile.educationsJson).slice(0, 50),
  };
  if (!selected)
    return {
      revision,
      entries: Object.entries(groups).flatMap(([kind, entries]) =>
        entries.map((entry, index) => ({
          kind,
          index,
          label: [
            "company" in entry
              ? `${entry.title} - ${entry.company}`
              : `${entry.school} - ${entry.degree}`,
            historyDateText(entry),
          ]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 250),
        })),
      ),
    };
  if (selected.revision !== revision)
    throw new AssistantError(
      "Your profile changed. Reload the entry list before filling.",
      409,
    );
  const entry = groups[selected.kind][selected.index];
  if (!entry) throw new AssistantError("Profile entry not found.", 404);
  // Only the explicitly selected entry is exported, not the full profile or
  // guessed legacy dates. Unknown months remain unknown.
  return {
    kind: selected.kind,
    entry: {
      ...("company" in entry
        ? { title: entry.title, company: entry.company }
        : { school: entry.school, degree: entry.degree }),
      location: entry.location,
      description: entry.description,
      dates: entry.dates,
    },
  };
}

export async function captureApplicationQuestions(
  userId: string,
  raw: unknown,
) {
  const input = captureSchema.parse(raw);
  return saveExtensionApplication(userId, input);
}

export async function confirmExtensionApplication(
  userId: string,
  raw: unknown,
) {
  const input = appliedConfirmationSchema.parse(raw);
  const result = await saveExtensionApplication(
    userId,
    { url: input.url, title: input.title, questions: [] },
    input.company,
  );
  if (result.canonicalJobId) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId: userId },
      select: { id: true },
    });
    if (profile)
      await enqueueDurableTopPicksRefresh({
        userId: profile.id,
        reason: "application_status_changed",
        priorityScore: 60,
      });
  }
  return result;
}

async function saveExtensionApplication(
  userId: string,
  input: ReturnType<typeof captureSchema.parse>,
  confirmedCompany?: string,
) {
  const context = applicationContext(input.url, true)!;
  const urlKeys = [
    context.url,
    ...(context.provider === "greenhouse"
      ? [context.url.replace("job-boards.", "boards.")]
      : context.provider === "lever" || context.provider === "ashby"
        ? [
            `${context.url}/${context.provider === "lever" ? "apply" : "application"}`,
          ]
        : []),
  ]
    .map((url) => normalizeUrlIdentityKey(url)!)
    .filter(Boolean);
  const knownJobs = await prisma.jobCanonical.findMany({
    where: { applyUrlKey: { in: urlKeys } },
    select: { id: true, title: true, company: true },
    take: 2,
  });
  // Attach only an unambiguous exact posting, never fuzzy company/title matches.
  const knownJob = knownJobs.length === 1 ? knownJobs[0] : null;
  const capture = () =>
    prisma.$transaction(async (tx) => {
      // Serialize repeat captures, including two extension popups on the same role.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const applications = await tx.trackedApplication.findMany({
        where: {
          userId,
          OR: [
            ...(knownJob ? [{ canonicalJobId: knownJob.id }] : []),
            ...[
              new URL(context.url).hostname,
              ...(context.provider === "greenhouse"
                ? [
                    new URL(context.url).hostname.replace(
                      "job-boards.",
                      "boards.",
                    ),
                  ]
                : []),
            ].flatMap((host) => [
              { roleUrl: { contains: host } },
              { canonicalJob: { applyUrl: { contains: host } } },
            ]),
          ],
        },
        select: {
          id: true,
          canonicalJobId: true,
          roleUrl: true,
          assistantState: true,
          canonicalJob: { select: { applyUrl: true } },
        },
        take: 2001,
      });
      if (applications.length > 2000)
        throw new AssistantError(
          "Too many matching application records. Use the application workspace.",
        );
      const existing = applications.find(
        (item) =>
          (knownJob && item.canonicalJobId === knownJob.id) ||
          [item.roleUrl, item.canonicalJob?.applyUrl].some(
            (url) => url && sameApplication(url, context.url),
          ),
      );
      if (existing) {
        // Use the same row lock as web saves; a late capture must not erase reviewed answers.
        await tx.$queryRaw`SELECT id FROM "TrackedApplication" WHERE id = ${existing.id} FOR UPDATE`;
        const current = await tx.trackedApplication.findUniqueOrThrow({
          where: { id: existing.id },
        });
        await tx.trackedApplication.update({
          where: { id: existing.id },
          data: {
            ...(confirmedCompany && !current.canonicalJobId
              ? { company: confirmedCompany, roleTitle: input.title }
              : {}),
            ...(!confirmedCompany
              ? {
                  assistantState: mergeCapturedQuestions(
                    parseAssistantState(current.assistantState),
                    input,
                  ),
                }
              : {}),
            ...(confirmedCompany &&
            ["WISHLIST", "PREPARING"].includes(current.status)
              ? {
                  status: "APPLIED",
                  events: {
                    create: {
                      type: "APPLIED",
                      note: "User confirmed submission on the employer site through the extension.",
                    },
                  },
                }
              : {}),
          },
        });
        return { id: existing.id, canonicalJobId: existing.canonicalJobId };
      }
      const created = await tx.trackedApplication.create({
        data: {
          userId,
          canonicalJobId: knownJob?.id,
          company: knownJob?.company ?? confirmedCompany ?? context.tenant,
          roleTitle: knownJob?.title ?? input.title,
          roleUrl: context.url,
          status: confirmedCompany ? "APPLIED" : "PREPARING",
          ...(!confirmedCompany
            ? { assistantState: mergeCapturedQuestions(null, input) }
            : {}),
          events: {
            create: {
              type: confirmedCompany ? "APPLIED" : "NOTE",
              note: confirmedCompany
                ? "User confirmed submission on the employer site through the extension."
                : "Questions captured for review. Nothing submitted.",
            },
          },
        },
      });
      return { id: created.id, canonicalJobId: created.canonicalJobId };
    });
  try {
    return await capture();
  } catch (error) {
    // A normal tracker action can race the extension despite our capture lock.
    if (
      knownJob &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      return capture();
    throw error;
  }
}

export async function getApplicationQuestionReview(userId: string, id: string) {
  const application = await prisma.trackedApplication.findFirst({
    where: { id, userId },
  });
  if (!application) return null;
  const state = parseAssistantState(application.assistantState);
  const profile = await prisma.userProfile.findUnique({
    where: { authUserId: userId },
    include: {
      preferences: { where: { key: ANSWER_LIBRARY_KEY } },
    },
  });
  const library = parseAnswerLibrary(profile?.preferences[0]?.value);
  const suggestions: Record<string, string> = Object.create(null);
  for (const question of state?.questions ?? []) {
    const saved = library.find(
      (answer) =>
        answer.companyId === state?.companyKey &&
        answer.questionKey === question.key,
    );
    if (
      saved &&
      decideAnswerReuse(
        { ...saved, approved: true, reuse: "suggest" },
        {
          kind: questionKind(question.label),
          questionKey: question.key,
          companyId: state?.companyKey,
          profileRevision: profile?.updatedAt.toISOString() ?? "",
        },
      ) === "suggest"
    )
      suggestions[question.key] = saved.answer;
  }
  return {
    id,
    company: application.company,
    roleTitle: application.roleTitle,
    reference: buildApplicationProfileReference(profile),
    state,
    // React's server/client boundary needs a plain object, not a null prototype.
    suggestions: { ...suggestions },
  };
}

export async function saveApplicationQuestionReview(
  userId: string,
  id: string,
  raw: unknown,
) {
  const input = reviewSaveSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const profile = await tx.userProfile.findUniqueOrThrow({
      where: { authUserId: userId },
    });
    await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${profile.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "TrackedApplication" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const application = await tx.trackedApplication.findFirst({
      where: { id, userId },
    });
    const state = parseAssistantState(application?.assistantState);
    if (!state) throw new AssistantError("Application review not found.", 404);
    if (state.revision !== input.revision)
      throw new AssistantError(
        "Questions changed in another tab. Reload before saving.",
        409,
      );
    if (
      new Set(input.answers.map((a) => a.key)).size !== input.answers.length ||
      input.answers.some(
        (answer) => !state.questions.some((q) => q.key === answer.key),
      )
    )
      throw new AssistantError(
        "The question list changed. Reload before saving.",
      );
    const preference = await tx.userPreference.findUnique({
      where: { userId_key: { userId: profile.id, key: ANSWER_LIBRARY_KEY } },
    });
    let library = parseAnswerLibrary(preference?.value);
    for (const answer of input.answers) {
      const question = state.questions.find((q) => q.key === answer.key)!;
      const kind = questionKind(question.label);
      if (
        (kind === "sensitive" || kind === "work_authorization") &&
        (answer.answer || answer.remember)
      )
        throw new AssistantError(
          "Answer personal and work-authorization questions on the employer form each time.",
        );
      question.answer = answer.answer;
      if (answer.remember) {
        library = library.filter(
          (item) =>
            item.companyId !== state.companyKey ||
            item.questionKey !== answer.key,
        );
        if (answer.answer)
          library.push({
            companyId: state.companyKey,
            companyLabel: application!.company.slice(0, 200),
            questionKey: answer.key,
            questionLabel: question.label,
            answer: answer.answer,
            kind: kind as "custom" | "company_relationship" | "referral",
            profileRevision: profile.updatedAt.toISOString(),
          });
      }
    }
    if (library.length > 60)
      throw new AssistantError(
        "Your answer library is full. Remove unused answers in extension settings first.",
      );
    await tx.userPreference.upsert({
      where: { userId_key: { userId: profile.id, key: ANSWER_LIBRARY_KEY } },
      create: {
        userId: profile.id,
        key: ANSWER_LIBRARY_KEY,
        value: JSON.stringify(library),
      },
      update: { value: JSON.stringify(library) },
    });
    state.revision += 1;
    await tx.trackedApplication.update({
      where: { id },
      data: { assistantState: state },
    });
    return { revision: state.revision };
  });
}
