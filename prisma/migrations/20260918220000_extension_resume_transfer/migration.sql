CREATE TABLE "ExtensionResumeTransfer" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "applicationUrl" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "documentId" TEXT,
    "documentUpdatedAt" TIMESTAMP(3),
    "codeHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtensionResumeTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExtensionResumeTransfer_connectionId_expiresAt_idx" ON "ExtensionResumeTransfer"("connectionId", "expiresAt");
CREATE INDEX "ExtensionResumeTransfer_documentId_idx" ON "ExtensionResumeTransfer"("documentId");
CREATE INDEX "ExtensionResumeTransfer_expiresAt_idx" ON "ExtensionResumeTransfer"("expiresAt");
ALTER TABLE "ExtensionResumeTransfer" ADD CONSTRAINT "ExtensionResumeTransfer_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExtensionConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtensionResumeTransfer" ADD CONSTRAINT "ExtensionResumeTransfer_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
