import { NextRequest, NextResponse } from "next/server";

import { getInvoiceByPublicId } from "@/lib/invoices";
import { approvalLink, createPayPalOrder } from "@/lib/paypal";

function getValue(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

export async function POST(request: NextRequest) {
  let publicId = "";
  try {
    const formData = await request.formData();
    publicId = getValue(formData, "publicId");

    if (!publicId) {
      return NextResponse.json({ ok: false, error: "Invoice id is required." }, { status: 400 });
    }

    const invoice = await getInvoiceByPublicId(publicId);
    if (!invoice) {
      return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "NEXT_PUBLIC_APP_BASE_URL is not configured." }, { status: 500 });
    }

    const order = await createPayPalOrder({
      publicId,
      invoiceNumber: invoice.invoice_number,
      customerName: invoice.customer_name,
      customerEmail: invoice.customer_email,
      amount: Number(invoice.total || 0),
      currency: invoice.currency || "USD",
      businessName: invoice.business.company_name || "S-Books",
      returnUrl: `${baseUrl}/api/paypal/capture-order?publicId=${encodeURIComponent(publicId)}`,
      cancelUrl: `${baseUrl}/invoice/${publicId}?canceled=1`
    });

    const approveUrl = approvalLink(order);
    if (!approveUrl) {
      return NextResponse.json({ ok: false, error: "PayPal did not return an approval URL." }, { status: 500 });
    }

    return NextResponse.redirect(approveUrl, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PayPal checkout error.";
    console.error("create-paypal-order failed", error);
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
