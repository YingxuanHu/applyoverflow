import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const revision = process.env.BUILD_SHA ?? "development";
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready", revision }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", revision }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
