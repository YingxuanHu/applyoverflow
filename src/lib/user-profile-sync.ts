import { prisma } from "@/lib/db";

type SyncableUser = {
  id: string;
  email: string;
  name: string;
};

export async function syncProfileForAuthUser(user: SyncableUser) {
  // Email can be reused or out of sync after a failed account update. It must
  // never authorize transferring an existing (including legacy) profile.
  const existingProfile = await prisma.userProfile.findUnique({
    where: { authUserId: user.id },
  });

  if (existingProfile) {
    if (
      existingProfile.email === user.email &&
      existingProfile.name === user.name
    ) {
      return existingProfile;
    }
  }

  return prisma.userProfile.upsert({
    where: { authUserId: user.id },
    create: {
      authUserId: user.id,
      email: user.email,
      name: user.name,
    },
    update: {
      email: user.email,
      name: user.name,
    },
  });
}
