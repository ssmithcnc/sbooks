import { NextRequest, NextResponse } from "next/server";

import { recordPayPalOrderCapture } from "@/lib/invoices";
import { capturePayPalOrder } from "@/lib/paypal";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") || "";
  const publicId = searchParams.get("publicId") || "";
  const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || "";

  if (!baseUrl || !publicId || !token) {
    if (baseUrl && publicId) {
      const errorUrl = new URL(`/invoice/${publicId}`, baseUrl);
      errorUrl.searchParams.set("error", "PayPal capture is missing required values.");
      return NextResponse.redirect(errorUrl, { status: 303 });
    }
    return NextResponse.json({ ok: false, error: "Invalid PayPal capture request." }, { status: 400 });
  }

  try {
    const order = await capturePayPalOrder(token);
    await recordPayPalOrderCapture(publicId, order);

    const successUrl = new URL(`/invoice/${publicId}`, baseUrl);
    successUrl.searchParams.set("paid", "1");
    successUrl.searchParams.set("provider", "paypal");
    return NextResponse.redirect(successUrl, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PayPal capture error.";
    const errorUrl = new URL(`/invoice/${publicId}`, baseUrl);
    errorUrl.searchParams.set("error", message);
    return NextResponse.redirect(errorUrl, { status: 303 });
  }
}
