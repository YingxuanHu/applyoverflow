-- Add explicit auth account state and hashed app-managed security tokens.
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DELETED');

CREATE TYPE "AuthSecurityTokenType" AS ENUM ('PASSWORD_RESET');

ALTER TABLE "User"
ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE TABLE "AuthSecurityToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "type" "AuthSecurityTokenType" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthSecurityToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSecurityToken_tokenHash_key" ON "AuthSecurityToken"("tokenHash");
CREATE INDEX "AuthSecurityToken_userId_type_expiresAt_idx" ON "AuthSecurityToken"("userId", "type", "expiresAt");
CREATE INDEX "AuthSecurityToken_type_expiresAt_idx" ON "AuthSecurityToken"("type", "expiresAt");

ALTER TABLE "AuthSecurityToken"
ADD CONSTRAINT "AuthSecurityToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
