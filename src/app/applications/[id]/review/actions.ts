"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentAuthUserId } from "@/lib/current-user";
import { consumeUserRateLimit } from "@/lib/api-rate-limit";
import {
  AssistantError,
  saveApplicationQuestionReview,
} from "@/lib/queries/application-assistant";

export async function saveQuestionReview(id: string, input: unknown) {
  try {
    const userId = await requireCurrentAuthUserId();
    if (
      !consumeUserRateLimit(userId, "assistant:save", {
        limit: 30,
        windowMs: 60_000,
      }).allowed
    )
      return { error: "Too many saves. Try again in a minute." };
    const result = await saveApplicationQuestionReview(userId, id, input);
    revalidatePath(`/applications/${id}/review`);
    revalidatePath("/settings/extension");
    return result;
  } catch (error) {
    return {
      error:
        error instanceof AssistantError
          ? error.message
          : "Could not save. Your answers are still here; try again.",
    };
  }
}
