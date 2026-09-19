import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { isSessionUsableByPolicy } from "@/lib/auth-session-policy";
import {
  allowedExtension,
  extensionCallback,
} from "@/lib/application-assistant";
import {
  AssistantError,
  hashSecret,
} from "@/lib/queries/application-assistant";
import { readStoredFileBounded } from "@/lib/storage";
import {
  EXTENSION_RESUME_MAX_BYTES,
  EXTENSION_RESUME_MIME_TYPES,
  canShareExtensionResume,
  resumeApprovalSchema,
  resumeExchangeSchema,
  resumeRequestSchema,
  resumeTransferFilename,
} from "@/lib/extension-resume";

type ExtensionIdentity = { userId: string; connectionId: string };
const resumeFileSelect = {
  id: true,
  type: true,
  mimeType: true,
  sizeBytes: true,
  originalFileName: true,
  storageKey: true,
  updatedAt: true,
  user: { select: { authUserId: true } },
} as const;
const connectionInclude = {
  session: true,
  user: { select: { status: true } },
} as const;
type Connection = Prisma.ExtensionConnectionGetPayload<{
  include: typeof connectionInclude;
}>;
function usable(connection: Connection | null, userId: string) {
  return (
    connection &&
    connection.userId === userId &&
    connection.user.status === "ACTIVE" &&
    connection.connectedAt &&
    connection.tokenHash &&
    connection.expiresAt > new Date() &&
    allowedExtension(connection.clientId) &&
    isSessionUsableByPolicy(connection.session)
  );
}

export async function requestExtensionResume(
  identity: ExtensionIdentity,
  raw: unknown,
) {
  const input = resumeRequestSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ExtensionConnection" WHERE id = ${identity.connectionId} FOR UPDATE`;
    const connection = await tx.extensionConnection.findUnique({
      where: { id: identity.connectionId },
      include: connectionInclude,
    });
    if (!usable(connection, identity.userId))
      throw new AssistantError("Reconnect the extension.", 401);
    // Ephemeral approvals expire; a connection has at most five pending choices.
    await tx.extensionResumeTransfer.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    if (
      (await tx.extensionResumeTransfer.count({
        where: { connectionId: identity.connectionId },
      })) >= 5
    )
      throw new AssistantError(
        "Finish or cancel an existing resume choice, or try again in ten minutes.",
        429,
      );
    const transfer = await tx.extensionResumeTransfer.create({
      data: {
        connectionId: identity.connectionId,
        applicationUrl: input.url,
        challenge: input.challenge,
        state: input.state,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return { id: transfer.id };
  });
}

export async function getExtensionResumeChoice(userId: string, id: string) {
  const transfer = await prisma.extensionResumeTransfer.findFirst({
    where: {
      id,
      connection: { userId },
      expiresAt: { gt: new Date() },
      codeHash: null,
    },
    include: { connection: { include: connectionInclude } },
  });
  if (!transfer || !usable(transfer.connection, userId)) return null;
  const documents = await prisma.document.findMany({
    where: {
      user: { authUserId: userId },
      type: "RESUME",
      sizeBytes: { gt: 0, lte: EXTENSION_RESUME_MAX_BYTES },
      mimeType: { in: [...EXTENSION_RESUME_MIME_TYPES] },
    },
    orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      type: true,
      title: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      isAiGenerated: true,
      updatedAt: true,
    },
  });
  const cancel = new URL(extensionCallback(transfer.connection.clientId));
  cancel.searchParams.set("state", transfer.state);
  cancel.searchParams.set("error", "cancelled");
  return {
    id,
    applicationUrl: transfer.applicationUrl,
    documents: documents.filter(canShareExtensionResume),
    cancelUrl: cancel.href,
  };
}

// Called only after an explicit choice on the authenticated web confirmation page.
export async function approveExtensionResume(
  identity: { authUserId: string; sessionId: string },
  raw: unknown,
) {
  const input = resumeApprovalSchema.parse(raw);
  const code = randomBytes(32).toString("base64url");
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.extensionResumeTransfer.findUnique({
      where: { id: input.id },
      include: { connection: { include: connectionInclude } },
    });
    if (
      !transfer ||
      !usable(transfer.connection, identity.authUserId) ||
      transfer.connection.sessionId !== identity.sessionId ||
      transfer.expiresAt <= new Date()
    )
      throw new AssistantError(
        "Resume choice expired or belongs to another sign-in. Reconnect and try again.",
        403,
      );
    const document = await tx.document.findFirst({
      where: {
        id: input.documentId,
        user: { authUserId: identity.authUserId },
      },
      select: resumeFileSelect,
    });
    if (!document || !canShareExtensionResume(document))
      throw new AssistantError("Choose a PDF or DOCX resume of 5 MB or less.");
    const result = await tx.extensionResumeTransfer.updateMany({
      where: { id: transfer.id, codeHash: null, expiresAt: { gt: new Date() } },
      data: {
        documentId: document.id,
        documentUpdatedAt: document.updatedAt,
        codeHash: hashSecret(code),
        expiresAt: new Date(Date.now() + 120_000),
      },
    });
    if (result.count !== 1)
      throw new AssistantError(
        "This choice was already confirmed. Start again.",
        409,
      );
    const callback = new URL(extensionCallback(transfer.connection.clientId));
    callback.searchParams.set("state", transfer.state);
    callback.searchParams.set("code", code);
    return callback.href;
  });
}

export async function exchangeExtensionResume(
  identity: ExtensionIdentity,
  raw: unknown,
) {
  const input = resumeExchangeSchema.parse(raw);
  const document = await prisma.$transaction(async (tx) => {
    const transfer = await tx.extensionResumeTransfer.findUnique({
      where: { id: input.id },
      include: {
        document: { select: resumeFileSelect },
        connection: { include: connectionInclude },
      },
    });
    if (
      !transfer ||
      transfer.connectionId !== identity.connectionId ||
      !usable(transfer.connection, identity.userId) ||
      transfer.expiresAt <= new Date() ||
      transfer.codeHash !== hashSecret(input.code) ||
      transfer.challenge !== hashSecret(input.verifier) ||
      transfer.applicationUrl !== input.url ||
      !transfer.document ||
      transfer.document.user.authUserId !== identity.userId ||
      transfer.document.updatedAt.getTime() !==
        transfer.documentUpdatedAt?.getTime() ||
      !canShareExtensionResume(transfer.document)
    )
      throw new AssistantError(
        "Resume approval expired or changed. Choose your resume again.",
        403,
      );
    // Atomic consume before reading bytes: concurrent exchanges cannot share twice.
    const consumed = await tx.extensionResumeTransfer.deleteMany({
      where: {
        id: transfer.id,
        codeHash: transfer.codeHash,
        expiresAt: { gt: new Date() },
      },
    });
    if (consumed.count !== 1)
      throw new AssistantError("Resume approval already used.", 409);
    return transfer.document;
  });
  const bytes = await readStoredFileBounded(
    document.storageKey,
    EXTENSION_RESUME_MAX_BYTES,
  );
  if (!bytes || bytes.length !== document.sizeBytes)
    throw new AssistantError(
      "Resume file is unavailable or changed. Check Documents and try again.",
      409,
    );
  const signature =
    document.mimeType === EXTENSION_RESUME_MIME_TYPES[0]
      ? bytes.subarray(0, 5).toString() === "%PDF-"
      : bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!signature)
    throw new AssistantError(
      "Resume file format could not be verified. Upload a new file in Documents.",
    );
  // Recheck revocation and document replacement after a potentially slow storage read.
  const connection = await prisma.extensionConnection.findUnique({
    where: { id: identity.connectionId },
    include: connectionInclude,
  });
  const current = await prisma.document.findFirst({
    where: {
      id: document.id,
      user: { authUserId: identity.userId },
      updatedAt: document.updatedAt,
      storageKey: document.storageKey,
    },
    select: { id: true },
  });
  if (!usable(connection, identity.userId) || !current)
    throw new AssistantError(
      "Resume access changed. Reconnect and choose again.",
      403,
    );
  return {
    name: resumeTransferFilename(document.originalFileName, document.mimeType),
    mimeType: document.mimeType,
    size: bytes.length,
    base64: bytes.toString("base64"),
  };
}
