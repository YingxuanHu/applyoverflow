import { headers } from "next/headers";

import { withPrismaConnectionRetry } from "@/lib/db";
import { auth } from "@/lib/auth";
import { syncProfileForAuthUser } from "@/lib/user-profile-sync";

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

type SessionUser = {
  id: string;
  email: string;
  name: string;
};

async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const requestHeaders = await headers();
    const session = await withPrismaConnectionRetry(() =>
      auth.api.getSession({
        headers: requestHeaders,
      })
    );

    if (!session?.user) {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  } catch {
    return null;
  }
}

async function ensureProfileForUser(user: SessionUser) {
  return syncProfileForAuthUser(user);
}

export async function getOptionalSessionUser() {
  return getSessionUser();
}

export async function getOptionalCurrentAuthUserId() {
  return (await getSessionUser())?.id ?? null;
}

export async function getOptionalCurrentUserProfile() {
  const sessionUser = await getSessionUser();

  if (sessionUser) {
    return ensureProfileForUser(sessionUser);
  }

  return null;
}

export async function requireCurrentUserProfile() {
  const profile = await getOptionalCurrentUserProfile();

  if (!profile) {
    throw new UnauthorizedError();
  }

  return profile;
}

export async function getOptionalCurrentProfileId() {
  return (await getOptionalCurrentUserProfile())?.id ?? null;
}

export async function requireCurrentProfileId() {
  return (await requireCurrentUserProfile()).id;
}

export async function requireCurrentUserIds() {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    throw new UnauthorizedError();
  }

  const profile = await ensureProfileForUser(sessionUser);

  return {
    authUserId: sessionUser.id,
    profileId: profile.id,
  };
}

export async function requireCurrentAuthUserId() {
  const userId = await getOptionalCurrentAuthUserId();
  if (!userId) {
    throw new UnauthorizedError();
  }
  return userId;
}
