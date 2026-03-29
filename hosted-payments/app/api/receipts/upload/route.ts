import { NextResponse } from "next/server";

import { saveReceiptUpload } from "@/lib/receipts";

export const runtime = "nodejs";

function redirectWithParams(url: URL, params: Record<string, string>) {
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("receipt_file");
  const redirectUrl = new URL("/receipts/upload", request.url);

  if (!(file instanceof File) || !file.size) {
    return redirectWithParams(redirectUrl, {
      error: "Please choose a receipt image or PDF before uploading.",
    });
  }

  try {
    const saved = await saveReceiptUpload({
      file,
      vendorName: String(formData.get("vendor_name") || ""),
      receiptDate: String(formData.get("receipt_date") || ""),
      totalAmount: String(formData.get("total_amount") || ""),
      notes: String(formData.get("notes") || ""),
      contactEmail: String(formData.get("contact_email") || ""),
    });

    return redirectWithParams(redirectUrl, {
      uploaded: "1",
      receipt: saved.id,
      path: saved.objectPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Receipt upload failed.";
    return redirectWithParams(redirectUrl, { error: message });
  }
}
