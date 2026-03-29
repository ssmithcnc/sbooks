import { NextRequest, NextResponse } from "next/server";

import { recordPayPalWebhookEvent } from "@/lib/invoices";
import { verifyPayPalWebhook, type PayPalWebhookEvent } from "@/lib/paypal";

export async function POST(request: NextRequest) {
  const bodyText = await request.text();
  let event: PayPalWebhookEvent;

  try {
    event = JSON.parse(bodyText) as PayPalWebhookEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid PayPal webhook payload." }, { status: 400 });
  }

  try {
    const verified = await verifyPayPalWebhook({
      headers: request.headers,
      eventBody: event
    });

    if (!verified) {
      return NextResponse.json({ ok: false, error: "PayPal webhook verification failed." }, { status: 400 });
    }

    await recordPayPalWebhookEvent(event);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown PayPal webhook error." },
      { status: 500 }
    );
  }
}
