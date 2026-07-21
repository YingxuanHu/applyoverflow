-- CreateEnum
CREATE TYPE "ResumeLibraryEntryType" AS ENUM ('EDUCATION', 'EXPERIENCE', 'PROJECT', 'SKILL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ResumeEntryVariationSource" AS ENUM ('USER', 'IMPORTED', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "ResumeEntryVariationApprovalStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResumeBuildStatus" AS ENUM ('DRAFT', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ResumeLibraryEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ResumeLibraryEntryType" NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT,
    "dateRange" TEXT,
    "location" TEXT,
    "summary" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceProfileKey" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeLibraryEntryVariation" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetRoleTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetIndustryTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "bulletsJson" JSONB NOT NULL DEFAULT '[]',
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "ResumeEntryVariationSource" NOT NULL DEFAULT 'USER',
    "approvalStatus" "ResumeEntryVariationApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeLibraryEntryVariation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeBuild" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetJobId" TEXT,
    "templateId" TEXT,
    "status" "ResumeBuildStatus" NOT NULL DEFAULT 'DRAFT',
    "sectionOrderJson" JSONB NOT NULL DEFAULT '[]',
    "snapshotJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeBuildItem" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "variationId" TEXT,
    "sectionType" "ResumeLibraryEntryType" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "includedBulletIds" JSONB NOT NULL DEFAULT '[]',
    "snapshotJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeBuildItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeLibraryEntry_userId_type_archivedAt_idx" ON "ResumeLibraryEntry"("userId", "type", "archivedAt");
CREATE UNIQUE INDEX "ResumeLibraryEntry_userId_sourceProfileKey_key" ON "ResumeLibraryEntry"("userId", "sourceProfileKey");
CREATE INDEX "ResumeLibraryEntryVariation_entryId_isDefault_idx" ON "ResumeLibraryEntryVariation"("entryId", "isDefault");
CREATE INDEX "ResumeBuild_userId_status_updatedAt_idx" ON "ResumeBuild"("userId", "status", "updatedAt" DESC);
CREATE INDEX "ResumeBuild_targetJobId_idx" ON "ResumeBuild"("targetJobId");
CREATE INDEX "ResumeBuild_templateId_idx" ON "ResumeBuild"("templateId");
CREATE INDEX "ResumeBuildItem_buildId_sectionType_sortOrder_idx" ON "ResumeBuildItem"("buildId", "sectionType", "sortOrder");
CREATE UNIQUE INDEX "ResumeBuildItem_buildId_entryId_key" ON "ResumeBuildItem"("buildId", "entryId");

-- AddForeignKey
ALTER TABLE "ResumeLibraryEntry" ADD CONSTRAINT "ResumeLibraryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResumeLibraryEntryVariation" ADD CONSTRAINT "ResumeLibraryEntryVariation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ResumeLibraryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResumeBuild" ADD CONSTRAINT "ResumeBuild_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResumeBuild" ADD CONSTRAINT "ResumeBuild_targetJobId_fkey" FOREIGN KEY ("targetJobId") REFERENCES "JobCanonical"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResumeBuild" ADD CONSTRAINT "ResumeBuild_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResumeBuildItem" ADD CONSTRAINT "ResumeBuildItem_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "ResumeBuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResumeBuildItem" ADD CONSTRAINT "ResumeBuildItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ResumeLibraryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResumeBuildItem" ADD CONSTRAINT "ResumeBuildItem_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "ResumeLibraryEntryVariation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
