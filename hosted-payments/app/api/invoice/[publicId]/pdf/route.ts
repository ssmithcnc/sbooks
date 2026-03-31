import { NextResponse } from "next/server";

import { generateInvoicePdf, getInvoiceByPublicId } from "@/lib/invoices";

type RouteProps = {
  params: Promise<{ publicId: string }>;
};

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: RouteProps) {
  const { publicId } = await params;
  const invoice = await getInvoiceByPublicId(publicId);

  if (!invoice) {
    return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
  }

  const pdf = await generateInvoicePdf(invoice);

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
