-- AlterTable
ALTER TABLE "ResumeBuild" ADD COLUMN "outputDocumentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ResumeBuild_outputDocumentId_key" ON "ResumeBuild"("outputDocumentId");

-- AddForeignKey
ALTER TABLE "ResumeBuild" ADD CONSTRAINT "ResumeBuild_outputDocumentId_fkey" FOREIGN KEY ("outputDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
