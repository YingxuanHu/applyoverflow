import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readProductUnsubscribeToken } from "@/lib/announcements/unsubscribe";
import { readRequestTextWithLimit, requestSizeLimitResponse } from "@/lib/api-utils";
import { resolveCanonicalAppUrl } from "@/lib/runtime-origin";

// GET never changes preferences: mail scanners routinely follow links.
export async function POST(request: NextRequest) {
  const tooLarge = requestSizeLimitResponse(request, 4096, "Unsubscribe request");
  if (tooLarge) return tooLarge;
  const body = await readRequestTextWithLimit(request, 4096, "Unsubscribe request", 5000);
  if (!body.ok) return body.response;
  const values = new URLSearchParams(body.text);
  const token = values.get("token") || request.nextUrl.searchParams.get("token") || "";
  const userId = readProductUnsubscribeToken(token);
  if (!userId) return new NextResponse("This unsubscribe link is invalid. Change your preferences in ApplyOverflow Settings.", { status: 400 });
  await prisma.user.updateMany({ where: { id: userId }, data: { productUpdatesEnabled: false } });
  if (values.get("List-Unsubscribe") === "One-Click") return new NextResponse("Unsubscribed", { headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(new URL("/email/product-updates?done=1", resolveCanonicalAppUrl()), { status: 303, headers: { "Cache-Control": "no-store" } });
}
