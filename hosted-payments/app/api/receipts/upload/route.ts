import { NextResponse } from "next/server";

import { uploadReceiptFromForm } from "@/lib/receipts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const receipt = await uploadReceiptFromForm(formData);
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not upload receipt.",
      },
      { status: 400 },
    );
  }
}
