ALTER TABLE "User" ADD COLUMN "productUpdatesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN "actionPath" TEXT;
CREATE TYPE "AnnouncementEmailStatus" AS ENUM ('NOT_SENT', 'SENDING', 'ACCEPTED', 'UNKNOWN');
CREATE TABLE "AnnouncementDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "emailStatus" "AnnouncementEmailStatus" NOT NULL DEFAULT 'NOT_SENT',
    "attemptedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    CONSTRAINT "AnnouncementDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnnouncementDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AnnouncementDelivery_userId_campaignKey_key" ON "AnnouncementDelivery"("userId", "campaignKey");
CREATE INDEX "AnnouncementDelivery_campaignKey_emailStatus_idx" ON "AnnouncementDelivery"("campaignKey", "emailStatus");
