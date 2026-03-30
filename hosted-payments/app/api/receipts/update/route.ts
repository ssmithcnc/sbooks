import { NextResponse } from "next/server";

import { updateReceiptUpload } from "@/lib/receipts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body?.receiptId) {
      return NextResponse.json({ ok: false, error: "Receipt id is required." }, { status: 400 });
    }

    const updated = await updateReceiptUpload(String(body.receiptId), {
      vendorName: String(body.vendorName || ""),
      category: String(body.category || ""),
      receiptDate: String(body.receiptDate || ""),
      totalAmount: String(body.totalAmount || ""),
      notes: String(body.notes || ""),
      contactEmail: String(body.contactEmail || ""),
    });

    return NextResponse.json({ ok: true, receipt: updated });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not update receipt.",
      },
      { status: 500 }
    );
  }
}
