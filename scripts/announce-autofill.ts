import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { prisma } from "../src/lib/db";
import { sendEmail, isEmailDeliveryConfigured, closeEmailDelivery } from "../src/lib/email";
import { AUTOFILL_ANNOUNCEMENT, autofillAnnouncementEmail } from "../src/lib/announcements/content";
import { deliverAutofillAnnouncement } from "../src/lib/announcements/delivery";
import { productUnsubscribeToken } from "../src/lib/announcements/unsubscribe";

async function main() {
  const { values } = parseArgs({ options: {
    send: { type: "boolean", default: false }, confirm: { type: "string" },
    channel: { type: "string", default: "in-app" }, max: { type: "string", default: "100" },
    "preview-only": { type: "boolean", default: false },
  } });
  const origin = process.env.APP_BASE_URL || "https://applyoverflow.com";
  if (new URL(origin).origin !== "https://applyoverflow.com" && !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Use the production domain or a local preview origin");
  const channel = values.channel;
  if (channel !== "email" && channel !== "in-app") throw new Error("Choose --channel=in-app or --channel=email");
  const max = Number(values.max);
  if (!Number.isInteger(max) || max < 1 || max > 1000) throw new Error("--max must be between 1 and 1000");
  if (values.send && (values.confirm !== AUTOFILL_ANNOUNCEMENT.key || values["preview-only"])) throw new Error(`Sending requires --confirm=${AUTOFILL_ANNOUNCEMENT.key} and cannot use --preview-only`);
  const email = autofillAnnouncementEmail(origin, `${origin}/email/product-updates`);
  await mkdir("output/announcements", { recursive: true });
  await writeFile("output/announcements/autofill.html", email.html);
  await writeFile("output/announcements/autofill.txt", email.text);
  if (values["preview-only"]) { console.log("Preview generated; no database access or messages sent."); return; }
  const eligibility = channel === "email" ? { status: "ACTIVE" as const, emailVerified: true, productUpdatesEnabled: true } : { status: "ACTIVE" as const };
  const alreadyHandled = channel === "email" ? { emailStatus: { not: "NOT_SENT" as const } } : { notifiedAt: { not: null } };
  const where = { ...eligibility, announcementDeliveries: { none: { campaignKey: AUTOFILL_ANNOUNCEMENT.key, ...alreadyHandled } } };
  const count = await prisma.user.count({ where });
  console.log(JSON.stringify({ campaign: AUTOFILL_ANNOUNCEMENT.key, channel, eligibleUnprocessed: count, batchLimit: max, mode: values.send ? "SEND" : "DRY RUN" }));
  if (!values.send) return;
  if (channel === "email") {
    if (!isEmailDeliveryConfigured()) throw new Error("SMTP is not configured; no sends attempted");
    productUnsubscribeToken("configuration-preflight");
  }
  const users = await prisma.user.findMany({ where, orderBy: { id: "asc" }, take: max, select: { id: true } });
  const results: Record<string, number> = {};
  for (const user of users) {
    const result = await deliverAutofillAnnouncement({ db: prisma, userId: user.id, channel, origin, send: sendEmail });
    results[result] = (results[result] || 0) + 1;
    if (result === "unknown" || result === "not-configured") {
      console.error("Stopped: delivery needs operator review. Do not retry uncertain sends."); process.exitCode = 1; break;
    }
    if (channel === "email") await setTimeout(1000);
  }
  console.log(JSON.stringify(results));
}
main().catch(() => { console.error("Announcement failed. Check configuration and delivery records; do not retry uncertain sends."); process.exitCode = 1; }).finally(async () => { closeEmailDelivery(); await prisma.$disconnect(); });
