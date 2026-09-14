import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import {
  API_BODY_LIMITS,
  errorResponse,
  handleApiRouteError,
  parseJsonBodyWithLimit,
  rateLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentProfileId } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import {
  SAVED_SEARCH_PREFIX,
  cleanSavedQuery,
  savedSearchSchema,
} from "@/lib/jobs/saved-searches";

export async function GET() {
  try {
    const userId = await requireCurrentProfileId();
    const rows = await prisma.userPreference.findMany({
      where: { userId, key: { startsWith: SAVED_SEARCH_PREFIX } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return successResponse({
      data: rows.flatMap((row) => {
        try {
          const parsed = savedSearchSchema.safeParse(JSON.parse(row.value));
          return parsed.success
            ? [
                {
                  ...parsed.data,
                  id: row.key.slice(SAVED_SEARCH_PREFIX.length),
                },
              ]
            : [];
        } catch {
          return [];
        }
      }),
    });
  } catch (error) {
    return handleApiRouteError(
      error,
      "GET saved searches",
      "Could not load saved searches",
    );
  }
}
const mutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      name: z.string().trim().min(1).max(60),
      query: z.string().max(4096),
    })
    .strict(),
  z
    .object({
      action: z.literal("rename"),
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({ action: z.enum(["reviewed", "delete"]), id: z.string().uuid() })
    .strict(),
]);
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitResponse(
      request,
      "jobs:saved-searches",
      API_RATE_LIMITS.authenticatedWrite,
    );
    if (limited) return limited;
    const userId = await requireCurrentProfileId();
    const body = await parseJsonBodyWithLimit(
      request,
      API_BODY_LIMITS.smallJson,
      "Saved search",
    );
    if (!body.ok) return body.response;
    const parsed = mutation.safeParse(body.data);
    if (!parsed.success) return errorResponse("Invalid saved search", 400);
    const input = parsed.data;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${userId} FOR UPDATE`;
      if (input.action === "create") {
        if (
          (await tx.userPreference.count({
            where: { userId, key: { startsWith: SAVED_SEARCH_PREFIX } },
          })) >= 20
        )
          return "limit";
        await tx.userPreference.create({
          data: {
            userId,
            key: `${SAVED_SEARCH_PREFIX}${randomUUID()}`,
            value: JSON.stringify({
              name: input.name,
              query: cleanSavedQuery(input.query),
              reviewedAt: new Date().toISOString(),
            }),
          },
        });
        return "ok";
      }
      const where = {
        userId_key: { userId, key: `${SAVED_SEARCH_PREFIX}${input.id}` },
      };
      const row = await tx.userPreference.findUnique({ where });
      if (!row) return "missing";
      if (input.action === "delete") await tx.userPreference.delete({ where });
      else {
        const saved = savedSearchSchema.parse(JSON.parse(row.value));
        await tx.userPreference.update({
          where,
          data: {
            value: JSON.stringify({
              ...saved,
              ...(input.action === "rename"
                ? { name: input.name }
                : { reviewedAt: new Date().toISOString() }),
            }),
          },
        });
      }
      return "ok";
    });
    if (result === "limit")
      return errorResponse(
        "You can save up to 20 searches. Remove one before adding another.",
        409,
      );
    if (result === "missing")
      return errorResponse("Saved search not found", 404);
    return successResponse({ success: true });
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST saved searches",
      "Could not update saved search",
    );
  }
}
