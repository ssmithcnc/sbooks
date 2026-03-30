import { NextResponse } from "next/server";

import { updateReceipt } from "@/lib/receipts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body?.receiptId) {
      return NextResponse.json({ ok: false, error: "Receipt id is required." }, { status: 400 });
    }

    const updated = await updateReceipt(String(body.receiptId), {
      vendor: String(body.vendor || ""),
      receiptDate: String(body.receiptDate || ""),
      orderNumber: String(body.orderNumber || ""),
      total: String(body.total || ""),
      tax: String(body.tax || ""),
      expenseCategory: String(body.expenseCategory || ""),
      pagesToKeep: String(body.pagesToKeep || ""),
      status: body.status,
      items: Array.isArray(body.items) ? body.items : [],
    });

    return NextResponse.json({ ok: true, receipt: updated });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not update receipt.",
      },
      { status: 500 },
    );
  }
}
