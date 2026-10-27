import { prisma, withPrismaConnectionRetry } from "@/lib/db";
import { getOptionalSessionUser } from "@/lib/current-user";
import { GETTING_STARTED_KEY, parseGuideState } from "@/lib/getting-started";

import { TopBarInner } from "./top-bar-inner";

export async function TopBar() {
  const sessionUser = await getOptionalSessionUser();

  if (!sessionUser) {
    return <TopBarInner user={null} />;
  }

  const [userRecord, unreadNotificationCount, guideRecord] = await Promise.all([
    withPrismaConnectionRetry(() =>
      prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
          email: true,
          emailVerified: true,
          image: true,
          name: true,
        },
      })
    ).catch(() => null),
    withPrismaConnectionRetry(() =>
      prisma.notification.count({
        where: {
          userId: sessionUser.id,
          readAt: null,
        },
      })
    ).catch(() => 0),
    withPrismaConnectionRetry(() => prisma.userPreference.findFirst({
      where: { key: GETTING_STARTED_KEY, user: { authUserId: sessionUser.id } },
      select: { value: true },
    })).catch(() => null),
  ]);

  const user = userRecord
    ? {
        email: userRecord.email,
        emailVerified: Boolean(userRecord.emailVerified),
        image: userRecord.image ?? null,
        name: userRecord.name ?? sessionUser.name,
      }
    : {
        email: sessionUser.email,
        emailVerified: false,
        image: null,
        name: sessionUser.name,
      };

  return <TopBarInner unreadNotificationCount={unreadNotificationCount} user={user}
    guide={{ accountId: sessionUser.id, state: parseGuideState(guideRecord?.value) }} />;
}
