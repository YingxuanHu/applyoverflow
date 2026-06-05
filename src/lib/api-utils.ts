import { NextResponse } from "next/server";

import { type ApiRateLimitRule, enforceApiRateLimit } from "@/lib/api-rate-limit";
import { UnauthorizedError } from "@/lib/current-user";

export function successResponse<T>(
  data: T,
  status = 200,
  headers?: HeadersInit
) {
  return NextResponse.json(data, { status, headers });
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function unauthorizedResponse(message = "Unauthorized") {
  return errorResponse(message, 401);
}

export function isUnauthorizedApiError(error: unknown) {
  return error instanceof UnauthorizedError;
}

export async function rateLimitResponse(
  request: Request,
  action: string,
  rule: ApiRateLimitRule
) {
  return enforceApiRateLimit(request, action, rule);
}

export function handleApiRouteError(
  error: unknown,
  logLabel: string,
  fallbackMessage: string,
  options?: {
    unauthorizedMessage?: string;
  }
) {
  if (isUnauthorizedApiError(error)) {
    return unauthorizedResponse(options?.unauthorizedMessage);
  }

  console.error(`${logLabel} error:`, error);
  return errorResponse(fallbackMessage, 500);
}

export function paginatedResponse<T>(
  data: T[],
  total: number | null,
  page: number,
  pageSize: number,
  hasNextPage?: boolean
) {
  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    totalPages: total === null ? null : Math.ceil(total / pageSize),
    hasNextPage: hasNextPage ?? (total === null ? null : page < Math.ceil(total / pageSize)),
  });
}

export function parseIntParam(
  value: string | null,
  defaultValue: number
): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
