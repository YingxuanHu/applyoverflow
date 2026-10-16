CREATE TABLE "OnboardingEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "journey" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "entry" TEXT NOT NULL,
  "filled" INTEGER,
  "remaining" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnboardingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OnboardingEvent_createdAt_idx" ON "OnboardingEvent"("createdAt");
CREATE INDEX "OnboardingEvent_userId_event_createdAt_idx" ON "OnboardingEvent"("userId", "event", "createdAt");
