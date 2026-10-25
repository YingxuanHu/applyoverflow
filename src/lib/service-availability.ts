import { NextResponse } from "next/server";

export const SERVICE_RETRY_AFTER_SECONDS = 30;
export const SERVICE_UNAVAILABLE_MESSAGE =
  "We couldn't reach an account service. Wait a moment and try again. You do not need to sign out.";

export class ServiceUnavailableError extends Error {
  constructor(cause: unknown) {
    super(SERVICE_UNAVAILABLE_MESSAGE, { cause });
    this.name = "ServiceUnavailableError";
  }
}

// Wrap dependency calls, not authentication decisions or Next request APIs.
export async function withServiceAvailability<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    throw new ServiceUnavailableError(error);
  }
}

export function serviceUnavailableResponse() {
  return NextResponse.json(
    { error: SERVICE_UNAVAILABLE_MESSAGE, code: "SERVICE_UNAVAILABLE", retryAfterSeconds: SERVICE_RETRY_AFTER_SECONDS },
    { status: 503, headers: { "Retry-After": String(SERVICE_RETRY_AFTER_SECONDS), "Cache-Control": "no-store" } },
  );
}

export function serviceUnavailablePageResponse() {
  // A relative link retries a GET at the same URL without reflecting its query,
  // clearing cookies, or automatically replaying a potentially unsafe action.
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Temporarily unavailable | ApplyOverflow</title></head><body><main><h1>Temporarily unavailable</h1><p>${SERVICE_UNAVAILABLE_MESSAGE}</p><p>Keep any open application or editor tabs open. No sign-out is needed.</p><p><a href="">Try again</a></p></main></body></html>`, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(SERVICE_RETRY_AFTER_SECONDS),
      "Referrer-Policy": "no-referrer",
    },
  });
}
