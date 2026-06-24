import { buildAiGeneratedDocumentTitle } from "@/lib/ai-document-naming";
import { prisma } from "@/lib/db";
import { buildDocumentStorageKey, deleteFile, saveFile } from "@/lib/storage";

import type { JobContext } from "./job-fit";
import {
  buildCoverLetterDocxBytes,
  buildCoverLetterDocxFileName,
  COVER_LETTER_DOCX_MIME_TYPE,
} from "./cover-letter-doc-html";

type PersistGeneratedCoverLetterInput = {
  userId: string;
  job: Pick<JobContext, "company" | "title">;
  text: string;
  sourceApplicationId?: string;
};

export async function persistGeneratedCoverLetterDocument({
  userId,
  job,
  text,
  sourceApplicationId,
}: PersistGeneratedCoverLetterInput) {
  const title = buildAiGeneratedDocumentTitle({
    kind: "COVER_LETTER",
    company: job.company,
    roleTitle: job.title,
  });
  const buffer = Buffer.from(buildCoverLetterDocxBytes(text));
  const fileName = buildCoverLetterDocxFileName(title);
  const storageKey = buildDocumentStorageKey({
    userId,
    title,
    extension: ".docx",
    type: "COVER_LETTER",
  });

  await saveFile(storageKey, buffer, { contentType: COVER_LETTER_DOCX_MIME_TYPE });
  const savedDoc = await prisma.document.create({
    data: {
      userId,
      type: "COVER_LETTER",
      title,
      originalFileName: fileName,
      filename: fileName,
      mimeType: COVER_LETTER_DOCX_MIME_TYPE,
      sizeBytes: buffer.byteLength,
      storageKey,
      isPrimary: false,
      isAiGenerated: true,
      sourceApplicationId,
      extractedText: text,
      extractedAt: new Date(),
    },
    select: { id: true, title: true },
  });

  if (sourceApplicationId) {
    const olderGeneratedDocs = await prisma.document.findMany({
      where: {
        userId,
        type: "COVER_LETTER",
        isAiGenerated: true,
        sourceApplicationId,
        id: { not: savedDoc.id },
        trackedApplicationLinks: { none: {} },
      },
      select: { id: true, storageKey: true },
    });

    if (olderGeneratedDocs.length > 0) {
      await prisma.document.deleteMany({
        where: { id: { in: olderGeneratedDocs.map((document) => document.id) } },
      });
      await Promise.allSettled(
        olderGeneratedDocs.map((document) => deleteFile(document.storageKey))
      );
    }
  }

  return savedDoc;
}
