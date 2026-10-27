import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { AUTOFILL_ANNOUNCEMENT, autofillAnnouncementEmail } from "./content";
import { productUnsubscribeToken } from "./unsubscribe";

type Mail = ReturnType<typeof autofillAnnouncementEmail> & { to: string; headers: Record<string, string> };
type Options = { db: PrismaClient; userId: string; channel: "in-app" | "email"; origin: string; send: (mail: Mail) => Promise<boolean> };

export async function createAutofillNotice(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true } });
  if (!user) return "ineligible" as const;
  await tx.announcementDelivery.createMany({ data: [{ userId, campaignKey: AUTOFILL_ANNOUNCEMENT.key }], skipDuplicates: true });
  const claimed = await tx.announcementDelivery.updateMany({
    where: { userId, campaignKey: AUTOFILL_ANNOUNCEMENT.key, notifiedAt: null }, data: { notifiedAt: new Date() },
  });
  if (!claimed.count) return "already-notified" as const;
  await tx.notification.create({ data: {
    userId, type: "SYSTEM", title: AUTOFILL_ANNOUNCEMENT.title,
    message: AUTOFILL_ANNOUNCEMENT.message, actionPath: AUTOFILL_ANNOUNCEMENT.path,
  } });
  return "notified" as const;
}

export async function deliverAutofillAnnouncement({ db, userId, channel, origin, send }: Options) {
  const where = { userId_campaignKey: { userId, campaignKey: AUTOFILL_ANNOUNCEMENT.key } };
  if (channel === "in-app") {
    return db.$transaction((tx) => createAutofillNotice(tx, userId));
  }

  const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE", emailVerified: true, productUpdatesEnabled: true }, select: { id: true, email: true } });
  if (!user) return "ineligible" as const;
  const unsubscribe = new URL("/email/product-updates", origin);
  unsubscribe.searchParams.set("token", productUnsubscribeToken(userId));
  const message = autofillAnnouncementEmail(origin, unsubscribe.href);
  const oneClick = new URL("/api/email/product-updates/unsubscribe", origin);
  oneClick.searchParams.set("token", productUnsubscribeToken(userId));
  await db.announcementDelivery.createMany({ data: [{ userId, campaignKey: AUTOFILL_ANNOUNCEMENT.key }], skipDuplicates: true });
  const claimed = await db.announcementDelivery.updateMany({
    where: { userId, campaignKey: AUTOFILL_ANNOUNCEMENT.key, emailStatus: "NOT_SENT", user: { status: "ACTIVE", emailVerified: true, productUpdatesEnabled: true, email: user.email } },
    data: { emailStatus: "SENDING", attemptedAt: new Date() },
  });
  if (!claimed.count) return "not-claimed" as const;
  // A crash or SMTP timeout may follow acceptance. SENDING/UNKNOWN must be
  // reconciled against provider logs by an operator, never retried blindly.
  try {
    const stillEligible = await db.user.count({ where: { id: userId, status: "ACTIVE", emailVerified: true, productUpdatesEnabled: true, email: user.email } });
    if (!stillEligible) {
      await db.announcementDelivery.update({ where, data: { emailStatus: "NOT_SENT", attemptedAt: null } });
      return "ineligible" as const;
    }
    const accepted = await send({ ...message, to: user.email, headers: {
      "List-Unsubscribe": `<${oneClick.href}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    } });
    await db.announcementDelivery.update({ where, data: accepted
      ? { emailStatus: "ACCEPTED", acceptedAt: new Date() }
      : { emailStatus: "NOT_SENT", attemptedAt: null } });
    return accepted ? "accepted" as const : "not-configured" as const;
  } catch {
    await db.announcementDelivery.update({ where, data: { emailStatus: "UNKNOWN" } });
    return "unknown" as const;
  }
}
