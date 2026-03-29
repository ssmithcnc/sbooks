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

export async function POST(request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || "";

  try {
    const body = (await request.json()) as { publicId?: string; orderId?: string };
    const publicId = String(body?.publicId || "").trim();
    const orderId = String(body?.orderId || "").trim();

    if (!baseUrl || !publicId || !orderId) {
      return NextResponse.json({ ok: false, error: "Invalid PayPal capture request." }, { status: 400 });
    }

    const order = await capturePayPalOrder(orderId);
    await recordPayPalOrderCapture(publicId, order);

    const successUrl = new URL(`/invoice/${publicId}`, baseUrl);
    successUrl.searchParams.set("paid", "1");
    successUrl.searchParams.set("provider", "paypal");
    return NextResponse.json({ ok: true, redirectUrl: successUrl.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PayPal capture error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
