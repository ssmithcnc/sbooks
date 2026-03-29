import { NextResponse } from "next/server";

import { createReceiptUploadTarget } from "@/lib/receipts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const target = await createReceiptUploadTarget({
      fileName: String(body?.fileName || ""),
      contentType: String(body?.contentType || ""),
    });
    return NextResponse.json({ ok: true, ...target });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare receipt upload.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
