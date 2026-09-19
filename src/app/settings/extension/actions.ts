"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentUserIds } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import {
  ANSWER_LIBRARY_KEY,
  parseAnswerLibrary,
} from "@/lib/application-assistant";

export async function revokeExtension(form: FormData) {
  const { authUserId } = await requireCurrentUserIds();
  const id = String(form.get("id") ?? "");
  await prisma.extensionConnection.deleteMany({
    where: { id, userId: authUserId },
  });
  revalidatePath("/settings/extension");
}

export async function forgetApplicationAnswer(form: FormData) {
  const { profileId } = await requireCurrentUserIds();
  const company = String(form.get("company") ?? "");
  const key = String(form.get("key") ?? "");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${profileId} FOR UPDATE`;
    const record = await tx.userPreference.findUnique({
      where: { userId_key: { userId: profileId, key: ANSWER_LIBRARY_KEY } },
    });
    if (record)
      await tx.userPreference.update({
        where: { id: record.id },
        data: {
          value: JSON.stringify(
            parseAnswerLibrary(record.value).filter(
              (item) => item.companyId !== company || item.questionKey !== key,
            ),
          ),
        },
      });
  });
  revalidatePath("/settings/extension");
  revalidatePath("/applications", "layout");
}
