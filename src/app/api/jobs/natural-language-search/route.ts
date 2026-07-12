import { type NextRequest } from "next/server";

import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import {
  API_BODY_LIMITS,
  errorResponse,
  handleApiRouteError,
  parseJsonBodyWithLimit,
  rateLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { parseNaturalLanguageJobSearch } from "@/lib/jobs/natural-language-search";

type NaturalLanguageSearchBody = {
  text?: unknown;
};

const MAX_NATURAL_LANGUAGE_SEARCH_LENGTH = 600;

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:natural-language-search",
      API_RATE_LIMITS.naturalLanguageJobSearch
    );
    if (rateLimited) return rateLimited;

    const body = await parseJsonBodyWithLimit<NaturalLanguageSearchBody>(
      request,
      API_BODY_LIMITS.smallJson,
      "Search request"
    );
    if (!body.ok) return body.response;

    const text = typeof body.data?.text === "string" ? body.data.text.trim() : "";
    if (!text) {
      return errorResponse("Describe the jobs you want to search for.", 400);
    }
    if (text.length > MAX_NATURAL_LANGUAGE_SEARCH_LENGTH) {
      return errorResponse(
        `Keep the description under ${MAX_NATURAL_LANGUAGE_SEARCH_LENGTH} characters.`,
        400
      );
    }

    return successResponse(parseNaturalLanguageJobSearch(text));
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST /api/jobs/natural-language-search",
      "Failed to interpret search"
    );
  }
}
