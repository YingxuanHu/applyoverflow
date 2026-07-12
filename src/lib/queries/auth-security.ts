import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { requireCurrentAuthUserId } from "@/lib/current-user";
import { prisma, withPrismaConnectionRetry } from "@/lib/db";

function isCredentialAccount(providerId: string) {
  return providerId === "credential";
}

export async function getAccountSecurityData() {
  const [userId, requestHeaders] = await Promise.all([
    requireCurrentAuthUserId(),
    headers(),
  ]);

  const [session, accounts, sessions] = await Promise.all([
    withPrismaConnectionRetry(() =>
      auth.api.getSession({
        headers: requestHeaders,
      })
    ),
    prisma.account.findMany({
      where: { userId },
      orderBy: [{ providerId: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        providerId: true,
        accountId: true,
        password: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.session.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      providerId: account.providerId,
      accountId: account.accountId,
      hasPassword: isCredentialAccount(account.providerId) && Boolean(account.password),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    })),
    currentSessionId: session?.session.id ?? null,
    sessions: sessions.map((sessionRecord) => ({
      ...sessionRecord,
      createdAt: sessionRecord.createdAt.toISOString(),
      updatedAt: sessionRecord.updatedAt.toISOString(),
      expiresAt: sessionRecord.expiresAt.toISOString(),
    })),
  };
}
