import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Direct signed uploads have been replaced by /api/receipts/upload.",
    },
    { status: 410 },
  );
}
