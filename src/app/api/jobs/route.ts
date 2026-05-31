import { type NextRequest } from "next/server";
import { getJobs, normalizeJobSortBy } from "@/lib/queries/jobs";
import { paginatedResponse, errorResponse, parseIntParam } from "@/lib/api-utils";
import { normalizeSalaryCurrency } from "@/lib/currency-conversion";
import {
  normalizeUserTimeZone,
  USER_TIME_ZONE_COOKIE,
} from "@/lib/time-zone";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const searchScope = sp.get("searchScope");
    const result = await getJobs(
      {
        search: sp.get("search") ?? undefined,
        searchScope:
          searchScope === "title" ||
          searchScope === "company" ||
          searchScope === "location" ||
          searchScope === "all"
            ? searchScope
            : undefined,
        titleSearch: sp.get("titleSearch") ?? undefined,
        companySearch: sp.get("companySearch") ?? undefined,
        locationSearch: sp.get("locationSearch") ?? undefined,
        location: sp.get("location") ?? undefined,
        source: sp.get("source") ?? undefined,
        region: sp.get("region") ?? undefined,
        workMode: sp.get("workMode") ?? undefined,
        employmentType: sp.get("employmentType") ?? undefined,
        industry: sp.get("industry") ?? undefined,
        roleCategory: sp.get("roleCategory") ?? undefined,
        roleFamily: sp.get("roleFamily") ?? undefined,
        salaryMin: parseIntParam(sp.get("salaryMin"), 0) || undefined,
        salaryMax: parseIntParam(sp.get("salaryMax"), 0) || undefined,
        salaryCurrency: normalizeSalaryCurrency(sp.get("salaryCurrency")) ?? undefined,
        careerStage: sp.get("careerStage") ?? undefined,
        experienceLevel: sp.get("experienceLevel") ?? undefined,
        expiry: sp.get("expiry") ?? undefined,
        posted: sp.get("posted") ?? undefined,
        submissionCategory: sp.get("submissionCategory") ?? undefined,
        status: sp.get("status") ?? undefined,
        sortBy: normalizeJobSortBy(sp.get("sortBy") ?? undefined),
        page: parseIntParam(sp.get("page"), 1),
      },
      {
        userTimeZone: normalizeUserTimeZone(
          request.cookies.get(USER_TIME_ZONE_COOKIE)?.value
        ),
      }
    );

    return paginatedResponse(
      result.data,
      result.total,
      result.page,
      result.pageSize,
      result.hasNextPage
    );
  } catch (error) {
    console.error("GET /api/jobs error:", error);
    return errorResponse("Failed to fetch jobs", 500);
  }
}
