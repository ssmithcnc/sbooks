import { NextResponse } from "next/server";

import { deleteReceiptUpload } from "@/lib/receipts";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const receiptId = String(body?.receiptId || "").trim();

    if (!receiptId) {
      return NextResponse.json({ ok: false, error: "Receipt id is required." }, { status: 400 });
    }

    const deleted = await deleteReceiptUpload(receiptId);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not delete receipt.",
      },
      { status: 500 }
    );
  }
}
