import { NextResponse } from "next/server";

import { type ApiRateLimitRule, enforceApiRateLimit } from "@/lib/api-rate-limit";
import { UnauthorizedError } from "@/lib/current-user";

export const API_BODY_LIMITS = {
  authJson: 8 * 1024,
  smallJson: 16 * 1024,
  mediumJson: 64 * 1024,
  resumeUpload: 12 * 1024 * 1024,
} as const;

type JsonBodyResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; response: NextResponse };

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

export function requestSizeLimitResponse(
  request: Request,
  maxBytes: number,
  label = "Request"
) {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    return null;
  }

  const contentLength = Number.parseInt(rawLength, 10);
  if (!Number.isFinite(contentLength) || contentLength <= maxBytes) {
    return null;
  }

  return NextResponse.json(
    {
      error: `${label} is too large.`,
      maxBytes,
    },
    { status: 413 }
  );
}

export async function parseJsonBodyWithLimit<T = unknown>(
  request: Request,
  maxBytes: number,
  label = "Request",
  invalidMessage = "Invalid JSON body"
): Promise<JsonBodyResult<T>> {
  const tooLarge = requestSizeLimitResponse(request, maxBytes, label);
  if (tooLarge) return { ok: false, response: tooLarge };

  const body = await readRequestTextWithLimit(request, maxBytes, label);
  if (!body.ok) return body;

  if (!body.text.trim()) {
    return { ok: true, data: null };
  }

  try {
    return { ok: true, data: JSON.parse(body.text) as T };
  } catch {
    return { ok: false, response: errorResponse(invalidMessage, 400) };
  }
}

async function readRequestTextWithLimit(
  request: Request,
  maxBytes: number,
  label: string
): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: `${label} is too large.`,
            maxBytes,
          },
          { status: 413 }
        ),
      };
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return { ok: true, text };
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

export function parseBoundedIntParam(
  value: string | null,
  defaultValue: number,
  options: { min?: number; max?: number } = {}
): number {
  const parsed = parseIntParam(value, defaultValue);
  const min = options.min ?? Number.NEGATIVE_INFINITY;
  const max = options.max ?? Number.POSITIVE_INFINITY;

  return Math.min(Math.max(parsed, min), max);
}
