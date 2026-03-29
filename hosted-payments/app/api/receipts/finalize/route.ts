import { NextResponse } from "next/server";

import { finalizeReceiptUpload } from "@/lib/receipts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const saved = await finalizeReceiptUpload({
      objectPath: String(body?.objectPath || ""),
      originalFileName: String(body?.originalFileName || ""),
      mimeType: String(body?.mimeType || ""),
      byteSize: Number(body?.byteSize || 0),
      vendorName: String(body?.vendorName || ""),
      receiptDate: String(body?.receiptDate || ""),
      totalAmount: String(body?.totalAmount || ""),
      notes: String(body?.notes || ""),
      contactEmail: String(body?.contactEmail || ""),
    });

    return NextResponse.json({ ok: true, receipt: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not finalize receipt upload.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
