import { NextResponse } from "next/server";

import { sendInvoiceEmail } from "@/lib/invoices";

type RouteProps = {
  params: Promise<{ publicId: string }>;
};

function getToken(request: Request) {
  const url = new URL(request.url);
  return (
    request.headers.get("x-invoice-admin-token") ||
    url.searchParams.get("token") ||
    ""
  ).trim();
}

export const runtime = "nodejs";

export async function POST(request: Request, { params }: RouteProps) {
  const url = new URL(request.url);
  const expectedToken = String(process.env.INVOICE_ADMIN_TOKEN || "").trim();
  if (!expectedToken) {
    return NextResponse.json({ ok: false, error: "INVOICE_ADMIN_TOKEN is not configured." }, { status: 500 });
  }

  const providedToken = getToken(request);
  if (providedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const { publicId } = await params;
  const returnUrl = new URL(`/invoice/${publicId}`, request.url);
  if (providedToken) {
    returnUrl.searchParams.set("manage", providedToken);
  }

  try {
    const result = await sendInvoiceEmail(publicId);
    if (url.searchParams.get("redirect") === "0") {
      return NextResponse.json({ ok: true, email: result });
    }
    returnUrl.searchParams.set("emailed", "1");
    return NextResponse.redirect(returnUrl, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invoice email failed.";
    if (url.searchParams.get("redirect") === "0") {
      return NextResponse.json(
        {
          ok: false,
          error: message,
        },
        { status: 500 },
      );
    }
    returnUrl.searchParams.set("emailError", message);
    return NextResponse.redirect(returnUrl, { status: 303 });
  }
}
