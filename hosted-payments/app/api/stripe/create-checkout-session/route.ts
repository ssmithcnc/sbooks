import { NextRequest, NextResponse } from "next/server";

import { getInvoiceByPublicId } from "@/lib/invoices";
import { getStripe } from "@/lib/stripe";

function getValue(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

export async function POST(request: NextRequest) {
  let publicId = "";
  try {
    const formData = await request.formData();
    publicId = getValue(formData, "publicId");
    const paymentMethod = getValue(formData, "paymentMethod") || "card";

    if (!publicId) {
      return NextResponse.json({ ok: false, error: "Invoice id is required." }, { status: 400 });
    }

    const invoice = await getInvoiceByPublicId(publicId);
    if (!invoice) {
      return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
    }

    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "NEXT_PUBLIC_APP_BASE_URL is not configured." }, { status: 500 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${baseUrl}/invoice/${publicId}?paid=1`,
      cancel_url: `${baseUrl}/invoice/${publicId}?canceled=1`,
      payment_method_types: paymentMethod === "us_bank_account" ? ["us_bank_account"] : ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: (invoice.currency || "USD").toLowerCase(),
            unit_amount: Math.round(Number(invoice.amount_due || invoice.total || 0) * 100),
            product_data: {
              name: `Invoice ${invoice.invoice_number}`,
              description: `S-Books payment for ${invoice.customer_name}`
            }
          }
        }
      ],
      customer_email: invoice.customer_email || undefined,
      metadata: {
        public_id: publicId,
        invoice_number: invoice.invoice_number,
        payment_method: paymentMethod
      }
    });

    if (!session.url) {
      return NextResponse.json({ ok: false, error: "Stripe did not return a checkout URL." }, { status: 500 });
    }

    return NextResponse.redirect(session.url, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stripe checkout error.";
    console.error("create-checkout-session failed", error);
    if (publicId) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || "";
      if (baseUrl) {
        const errorUrl = new URL(`/invoice/${publicId}`, baseUrl);
        errorUrl.searchParams.set("error", message);
        return NextResponse.redirect(errorUrl, { status: 303 });
      }
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
