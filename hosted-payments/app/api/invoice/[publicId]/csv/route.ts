import { NextResponse } from "next/server";

import { getInvoiceByPublicId, invoiceToCsv } from "@/lib/invoices";

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

  return new NextResponse(invoiceToCsv(invoice), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${invoice.invoice_number}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
