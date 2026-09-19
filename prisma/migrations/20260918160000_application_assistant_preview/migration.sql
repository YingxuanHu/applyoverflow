ALTER TABLE "TrackedApplication" ADD COLUMN "assistantState" JSONB;

CREATE TABLE "ExtensionConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "codeHash" TEXT,
  "challenge" TEXT NOT NULL,
  "tokenHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "connectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExtensionConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExtensionConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExtensionConnection_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExtensionConnection_codeHash_key" ON "ExtensionConnection"("codeHash");
CREATE UNIQUE INDEX "ExtensionConnection_tokenHash_key" ON "ExtensionConnection"("tokenHash");
CREATE INDEX "ExtensionConnection_userId_expiresAt_idx" ON "ExtensionConnection"("userId", "expiresAt");
