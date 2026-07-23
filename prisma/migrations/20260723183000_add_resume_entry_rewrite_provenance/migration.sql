ALTER TABLE "ResumeLibraryEntryVariation"
  ADD COLUMN "sourceVariationId" TEXT,
  ADD COLUMN "rewrittenBulletIndexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

CREATE INDEX "ResumeLibraryEntryVariation_sourceVariationId_idx"
  ON "ResumeLibraryEntryVariation"("sourceVariationId");
