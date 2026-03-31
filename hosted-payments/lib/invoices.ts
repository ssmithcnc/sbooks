import Stripe from "stripe";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Resend } from "resend";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { PayPalOrderResponse, PayPalWebhookEvent } from "@/lib/paypal";

type InvoiceRecord = {
  id: string;
  public_id: string;
  invoice_number: string;
  customer_name: string;
  customer_email: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  status: string;
  payment_status: string;
  payment_page_url: string | null;
  latest_checkout_url: string | null;
  metadata: Record<string, unknown> | null;
  payment_options?: {
    accept_manual_ach: boolean;
    accept_stripe_card: boolean;
    accept_stripe_ach: boolean;
    accept_paypal: boolean;
    accept_venmo: boolean;
  };
};

type PaymentOptionsRecord = {
  accept_manual_ach: boolean;
  accept_stripe_card: boolean;
  accept_stripe_ach: boolean;
  accept_paypal: boolean;
  accept_venmo: boolean;
};

type BusinessProfileRecord = {
  id: string;
  company_name: string | null;
  company_email: string | null;
  company_phone: string | null;
  company_website: string | null;
  manual_bank_instructions: string | null;
};

type InvoiceLineItemDbRow = {
  id: string;
  sort_order: number | null;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  metadata: Record<string, unknown> | null;
};

export type InvoiceLineItem = {
  id: string;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price: number | null;
  amount: number;
  metadata: Record<string, unknown>;
};

export type InvoiceDetails = InvoiceRecord & {
  amount_due: number;
  manual_bank_instructions: string | null;
  business: {
    company_name: string;
    company_email: string | null;
    company_phone: string | null;
    company_website: string | null;
  };
  customer: {
    billing_address: string | null;
    company_name: string | null;
    contact_name: string | null;
  };
  notes: string | null;
  po_number: string | null;
  line_items: InvoiceLineItem[];
  public_url: string | null;
};

type PaymentEventInsert = {
  invoice_id: string | null;
  provider: string;
  provider_event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9.-]/g, "").trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Due on receipt";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function getBaseUrl() {
  return clean(process.env.NEXT_PUBLIC_APP_BASE_URL);
}

function getPublicInvoiceUrl(publicId: string) {
  const baseUrl = getBaseUrl();
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}/invoice/${publicId}` : null;
}

function normalizeLineItemsFromMetadata(metadata: Record<string, unknown> | null, invoice: Pick<InvoiceRecord, "subtotal" | "tax_amount" | "total">) {
  const metadataItems =
    (Array.isArray(metadata?.line_items) ? metadata?.line_items : null) ||
    (Array.isArray(metadata?.items) ? metadata?.items : null) ||
    [];

  const normalized = metadataItems
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const quantity = toNumber(row.quantity ?? row.qty) ?? 1;
      const unitPrice = toNumber(row.unit_price ?? row.unitPrice ?? row.rate);
      const explicitAmount = toNumber(row.amount ?? row.total ?? row.line_total);
      const amount = explicitAmount ?? (unitPrice !== null ? Number((quantity * unitPrice).toFixed(2)) : 0);

      return {
        id: clean(row.id) || `meta-${index + 1}`,
        sort_order: index,
        description: clean(row.description || row.name || row.title || `Line item ${index + 1}`),
        quantity,
        unit_price: unitPrice,
        amount,
        metadata: row,
      } satisfies InvoiceLineItem;
    })
    .filter((item) => item.description);

  if (normalized.length) return normalized;

  return [
    {
      id: "summary-subtotal",
      sort_order: 0,
      description: "Invoice subtotal",
      quantity: 1,
      unit_price: invoice.subtotal || invoice.total || 0,
      amount: invoice.subtotal || invoice.total || 0,
      metadata: {},
    },
    ...(invoice.tax_amount
      ? [
          {
            id: "summary-tax",
            sort_order: 1,
            description: "Sales tax",
            quantity: 1,
            unit_price: invoice.tax_amount,
            amount: invoice.tax_amount,
            metadata: {},
          } satisfies InvoiceLineItem,
        ]
      : []),
  ];
}

async function findInvoiceIdByPublicId(publicId: string | null) {
  if (!publicId) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("invoices")
    .select("id")
    .eq("public_id", publicId)
    .returns<{ id: string } | null>()
    .maybeSingle();

  const invoiceLookup = data as { id: string } | null;
  return invoiceLookup?.id || null;
}

async function insertPaymentEvent(record: PaymentEventInsert) {
  const supabase = getSupabaseAdmin();
  await (supabase.from("payment_events") as any).insert(record);
}

async function markInvoicePaid(invoiceId: string, latestCheckoutUrl: string | null = null) {
  const supabase = getSupabaseAdmin();
  await (supabase.from("invoices") as any)
    .update({
      payment_status: "paid",
      status: "paid",
      latest_checkout_url: latestCheckoutUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
}

async function getInvoiceLineItems(invoice: InvoiceRecord) {
  const metadataFallback = normalizeLineItemsFromMetadata(invoice.metadata, invoice);
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await (supabase.from("invoice_line_items") as any)
      .select("id, sort_order, description, quantity, unit_price, amount, metadata")
      .eq("invoice_id", invoice.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return metadataFallback;
    }

    const rows = (data || []) as InvoiceLineItemDbRow[];
    if (!rows.length) {
      return metadataFallback;
    }

    return rows.map((row, index) => {
      const quantity = toNumber(row.quantity) ?? 1;
      const unitPrice = toNumber(row.unit_price);
      const amount = toNumber(row.amount) ?? (unitPrice !== null ? Number((quantity * unitPrice).toFixed(2)) : 0);

      return {
        id: row.id,
        sort_order: row.sort_order ?? index,
        description: clean(row.description) || `Line item ${index + 1}`,
        quantity,
        unit_price: unitPrice,
        amount,
        metadata: row.metadata || {},
      } satisfies InvoiceLineItem;
    });
  } catch {
    return metadataFallback;
  }
}

function getMetadataText(metadata: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = clean(metadata?.[key]);
    if (value) return value;
  }
  return null;
}

function getCustomerAddress(metadata: Record<string, unknown> | null) {
  const direct = getMetadataText(metadata, ["billing_address", "customer_address", "bill_to"]);
  if (direct) return direct;

  const lines = [
    getMetadataText(metadata, ["customer_company", "billing_company"]),
    getMetadataText(metadata, ["customer_contact", "contact_name"]),
    getMetadataText(metadata, ["address_line_1", "billing_address_line_1"]),
    getMetadataText(metadata, ["address_line_2", "billing_address_line_2"]),
    [getMetadataText(metadata, ["city"]), getMetadataText(metadata, ["state"]), getMetadataText(metadata, ["postal_code", "zip"])]
      .filter(Boolean)
      .join(", "),
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toParagraphHtml(value: string | null) {
  if (!value) return "";
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function invoiceToCsv(invoice: InvoiceDetails) {
  const headers = [
    "invoice_number",
    "issue_date",
    "due_date",
    "customer_name",
    "customer_email",
    "po_number",
    "line_description",
    "quantity",
    "unit_price",
    "line_total",
    "subtotal",
    "tax_amount",
    "total",
    "amount_paid",
    "amount_due",
    "status",
    "payment_status",
  ];

  const rows = invoice.line_items.map((item) => [
    invoice.invoice_number,
    invoice.issue_date,
    invoice.due_date || "",
    invoice.customer_name,
    invoice.customer_email || "",
    invoice.po_number || "",
    item.description,
    String(item.quantity),
    item.unit_price ?? "",
    item.amount,
    invoice.subtotal,
    invoice.tax_amount,
    invoice.total,
    invoice.amount_paid,
    invoice.amount_due,
    invoice.status,
    invoice.payment_status,
  ]);

  const values = [headers, ...rows];
  return values
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`)
        .join(","),
    )
    .join("\n");
}

export async function generateInvoicePdf(invoice: InvoiceDetails) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 48;
  const navy = rgb(0.08, 0.17, 0.33);
  const blue = rgb(0.2, 0.47, 0.92);
  const muted = rgb(0.34, 0.41, 0.52);
  const line = rgb(0.85, 0.89, 0.95);
  const black = rgb(0.12, 0.14, 0.17);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({
    x: 0,
    y: height - 116,
    width,
    height: 116,
    color: navy,
  });

  page.drawText(invoice.business.company_name, {
    x: margin,
    y: height - 54,
    size: 22,
    font: bold,
    color: rgb(1, 1, 1),
  });

  page.drawText(`Invoice ${invoice.invoice_number}`, {
    x: width - margin - 190,
    y: height - 54,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  });

  const businessDetails = [invoice.business.company_email, invoice.business.company_phone, invoice.business.company_website]
    .filter(Boolean)
    .join("  •  ");

  if (businessDetails) {
    page.drawText(businessDetails, {
      x: margin,
      y: height - 80,
      size: 10,
      font: regular,
      color: rgb(0.86, 0.92, 1),
    });
  }

  let y = height - 150;

  page.drawText("Bill To", {
    x: margin,
    y,
    size: 11,
    font: bold,
    color: muted,
  });
  page.drawText("Summary", {
    x: width - 210,
    y,
    size: 11,
    font: bold,
    color: muted,
  });

  y -= 24;
  const customerBlock = [invoice.customer.company_name, invoice.customer.contact_name, invoice.customer.billing_address]
    .filter(Boolean)
    .join("\n");

  for (const lineText of customerBlock.split("\n").filter(Boolean)) {
    page.drawText(lineText, {
      x: margin,
      y,
      size: 11,
      font: regular,
      color: black,
    });
    y -= 15;
  }

  const summaryTop = height - 174;
  const summaryRows = [
    ["Issue date", formatDate(invoice.issue_date)],
    ["Due date", formatDate(invoice.due_date)],
    ["Status", invoice.payment_status],
    ["Amount due", formatMoney(invoice.amount_due, invoice.currency)],
  ];

  let summaryY = summaryTop;
  for (const [label, value] of summaryRows) {
    page.drawText(label, {
      x: width - 210,
      y: summaryY,
      size: 10,
      font: bold,
      color: muted,
    });
    page.drawText(value, {
      x: width - 120,
      y: summaryY,
      size: 10,
      font: regular,
      color: black,
    });
    summaryY -= 16;
  }

  y = Math.min(y, summaryY) - 24;

  page.drawRectangle({
    x: margin,
    y,
    width: width - margin * 2,
    height: 24,
    color: rgb(0.95, 0.97, 1),
    borderColor: line,
    borderWidth: 1,
  });

  const columns = {
    description: margin + 10,
    quantity: width - 230,
    unitPrice: width - 170,
    amount: width - 90,
  };

  page.drawText("Description", { x: columns.description, y: y + 7, size: 10, font: bold, color: navy });
  page.drawText("Qty", { x: columns.quantity, y: y + 7, size: 10, font: bold, color: navy });
  page.drawText("Unit", { x: columns.unitPrice, y: y + 7, size: 10, font: bold, color: navy });
  page.drawText("Total", { x: columns.amount, y: y + 7, size: 10, font: bold, color: navy });

  y -= 26;

  for (const item of invoice.line_items) {
    if (y < 130) {
      break;
    }
    page.drawLine({
      start: { x: margin, y: y + 18 },
      end: { x: width - margin, y: y + 18 },
      thickness: 1,
      color: line,
    });
    page.drawText(item.description.slice(0, 64), {
      x: columns.description,
      y,
      size: 10,
      font: regular,
      color: black,
    });
    page.drawText(String(item.quantity), {
      x: columns.quantity,
      y,
      size: 10,
      font: regular,
      color: black,
    });
    page.drawText(item.unit_price !== null ? formatMoney(item.unit_price, invoice.currency) : "-", {
      x: columns.unitPrice,
      y,
      size: 10,
      font: regular,
      color: black,
    });
    page.drawText(formatMoney(item.amount, invoice.currency), {
      x: columns.amount,
      y,
      size: 10,
      font: regular,
      color: black,
    });
    y -= 22;
  }

  y -= 10;
  const totals = [
    ["Subtotal", formatMoney(invoice.subtotal, invoice.currency)],
    ["Tax", formatMoney(invoice.tax_amount, invoice.currency)],
    ["Paid", formatMoney(invoice.amount_paid, invoice.currency)],
    ["Amount due", formatMoney(invoice.amount_due, invoice.currency)],
  ];

  for (const [label, value] of totals) {
    page.drawText(label, {
      x: width - 210,
      y,
      size: label === "Amount due" ? 11 : 10,
      font: label === "Amount due" ? bold : regular,
      color: label === "Amount due" ? blue : black,
    });
    page.drawText(value, {
      x: width - 110,
      y,
      size: label === "Amount due" ? 11 : 10,
      font: label === "Amount due" ? bold : regular,
      color: label === "Amount due" ? blue : black,
    });
    y -= 16;
  }

  if (invoice.notes && y > 90) {
    y -= 10;
    page.drawText("Notes", {
      x: margin,
      y,
      size: 11,
      font: bold,
      color: muted,
    });
    y -= 18;

    for (const noteLine of invoice.notes.split("\n")) {
      if (y < 60) break;
      page.drawText(noteLine.slice(0, 88), {
        x: margin,
        y,
        size: 10,
        font: regular,
        color: black,
      });
      y -= 14;
    }
  }

  return Buffer.from(await pdf.save());
}

function buildInvoiceEmailHtml(invoice: InvoiceDetails) {
  const lineItems = invoice.line_items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #d6deec;color:#10203a;">${escapeHtml(item.description)}</td>
          <td style="padding:12px 0;border-bottom:1px solid #d6deec;color:#60708c;text-align:right;">${item.quantity}</td>
          <td style="padding:12px 0;border-bottom:1px solid #d6deec;color:#60708c;text-align:right;">${item.unit_price !== null ? escapeHtml(formatMoney(item.unit_price, invoice.currency)) : "-"}</td>
          <td style="padding:12px 0;border-bottom:1px solid #d6deec;color:#10203a;text-align:right;font-weight:700;">${escapeHtml(
            formatMoney(item.amount, invoice.currency),
          )}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="margin:0;padding:32px;background:#edf4fb;font-family:Segoe UI,Tahoma,sans-serif;color:#10203a;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #d6deec;">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#18253d,#2c68c9);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.74;">Invoice ready</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-0.04em;margin-top:8px;">${escapeHtml(invoice.invoice_number)}</div>
          <div style="margin-top:8px;font-size:16px;opacity:0.82;">${escapeHtml(invoice.business.company_name)} sent an invoice to ${escapeHtml(
            invoice.customer_name,
          )}</div>
        </div>
        <div style="padding:28px 32px;">
          <div style="display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;">
            <div>
              <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#60708c;">Amount due</div>
              <div style="font-size:36px;font-weight:800;color:#2c68c9;margin-top:10px;">${escapeHtml(
                formatMoney(invoice.amount_due, invoice.currency),
              )}</div>
            </div>
            <div style="min-width:220px;">
              <div style="display:flex;justify-content:space-between;padding:6px 0;color:#60708c;"><span>Issue date</span><span>${escapeHtml(
                formatDate(invoice.issue_date),
              )}</span></div>
              <div style="display:flex;justify-content:space-between;padding:6px 0;color:#60708c;"><span>Due date</span><span>${escapeHtml(
                formatDate(invoice.due_date),
              )}</span></div>
              <div style="display:flex;justify-content:space-between;padding:6px 0;color:#60708c;"><span>Status</span><span>${escapeHtml(
                invoice.payment_status,
              )}</span></div>
            </div>
          </div>

          <div style="margin-top:24px;">
            <a href="${escapeHtml(invoice.public_url || "#")}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:linear-gradient(135deg,#2c68c9,#15428e);color:#ffffff;font-weight:700;text-decoration:none;">
              View and pay invoice
            </a>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-top:28px;">
            <thead>
              <tr>
                <th style="text-align:left;padding-bottom:10px;border-bottom:1px solid #d6deec;color:#60708c;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">Description</th>
                <th style="text-align:right;padding-bottom:10px;border-bottom:1px solid #d6deec;color:#60708c;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">Qty</th>
                <th style="text-align:right;padding-bottom:10px;border-bottom:1px solid #d6deec;color:#60708c;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">Unit</th>
                <th style="text-align:right;padding-bottom:10px;border-bottom:1px solid #d6deec;color:#60708c;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">Total</th>
              </tr>
            </thead>
            <tbody>${lineItems}</tbody>
          </table>

          <div style="margin-top:24px;padding-top:18px;border-top:1px solid #d6deec;">
            <div style="display:flex;justify-content:space-between;padding:6px 0;color:#60708c;"><span>Subtotal</span><strong>${escapeHtml(
              formatMoney(invoice.subtotal, invoice.currency),
            )}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;color:#60708c;"><span>Tax</span><strong>${escapeHtml(
              formatMoney(invoice.tax_amount, invoice.currency),
            )}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;color:#60708c;"><span>Paid</span><strong>${escapeHtml(
              formatMoney(invoice.amount_paid, invoice.currency),
            )}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:10px 0 0;color:#10203a;font-size:18px;"><span>Amount due</span><strong>${escapeHtml(
              formatMoney(invoice.amount_due, invoice.currency),
            )}</strong></div>
          </div>

          ${
            invoice.notes
              ? `<div style="margin-top:24px;padding:18px;border-radius:18px;background:#f5f9ff;color:#60708c;">
                  <div style="font-weight:700;color:#10203a;margin-bottom:6px;">Notes</div>
                  <div>${toParagraphHtml(invoice.notes)}</div>
                </div>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function buildInvoiceEmailText(invoice: InvoiceDetails) {
  return [
    `${invoice.business.company_name} sent you invoice ${invoice.invoice_number}.`,
    "",
    `Customer: ${invoice.customer_name}`,
    `Issue date: ${formatDate(invoice.issue_date)}`,
    `Due date: ${formatDate(invoice.due_date)}`,
    `Amount due: ${formatMoney(invoice.amount_due, invoice.currency)}`,
    "",
    `View and pay: ${invoice.public_url || "(public URL not configured)"}`,
    "",
    "Line items:",
    ...invoice.line_items.map(
      (item) =>
        `- ${item.description}: ${item.quantity} x ${item.unit_price !== null ? formatMoney(item.unit_price, invoice.currency) : "-"} = ${formatMoney(
          item.amount,
          invoice.currency,
        )}`,
    ),
    ...(invoice.notes ? ["", "Notes:", invoice.notes] : []),
  ].join("\n");
}

async function logInvoiceEmailDelivery(payload: {
  invoiceId: string;
  recipientEmail: string;
  subject: string;
  providerMessageId: string | null;
  status: string;
  body: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  try {
    await (supabase.from("invoice_email_deliveries") as any).insert({
      invoice_id: payload.invoiceId,
      provider: "resend",
      provider_message_id: payload.providerMessageId,
      recipient_email: payload.recipientEmail,
      subject: payload.subject,
      status: payload.status,
      payload: payload.body,
    });
  } catch (error) {
    console.error("Failed to log invoice email delivery", error);
  }
}

export async function getInvoiceByPublicId(publicId: string): Promise<InvoiceDetails | null> {
  const supabase = getSupabaseAdmin();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select(
      "id, public_id, invoice_number, customer_name, customer_email, issue_date, due_date, currency, subtotal, tax_amount, total, amount_paid, status, payment_status, payment_page_url, latest_checkout_url, metadata",
    )
    .eq("public_id", publicId)
    .returns<InvoiceRecord | null>()
    .maybeSingle();

  if (invoiceError) {
    throw invoiceError;
  }

  if (!invoice) {
    if (publicId === "demo-invoice") {
      return {
        id: "demo-invoice",
        public_id: publicId,
        invoice_number: "INV-DEMO",
        customer_name: "Demo Customer",
        customer_email: "customer@example.com",
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: null,
        currency: "USD",
        subtotal: 250,
        tax_amount: 0,
        total: 250,
        amount_paid: 0,
        status: "open",
        payment_status: "unpaid",
        payment_page_url: getPublicInvoiceUrl(publicId),
        latest_checkout_url: null,
        metadata: {
          customer_company: "Demo Customer LLC",
          customer_contact: "Avery Customer",
          billing_address: "123 Cedar Street\nAustin, TX 78701",
          notes: "Thank you for your business. Please include the invoice number with payment.",
          line_items: [
            { description: "Custom metal fabrication", quantity: 1, unit_price: 180, amount: 180 },
            { description: "Powder coating", quantity: 1, unit_price: 70, amount: 70 },
          ],
        },
        amount_due: 250,
        manual_bank_instructions: "CNC Powder ACH: include invoice INV-DEMO in the remittance memo.",
        business: {
          company_name: "CNC Powder, LLC",
          company_email: "steve@cncpowder.com",
          company_phone: null,
          company_website: null,
        },
        customer: {
          billing_address: "123 Cedar Street\nAustin, TX 78701",
          company_name: "Demo Customer LLC",
          contact_name: "Avery Customer",
        },
        notes: "Thank you for your business. Please include the invoice number with payment.",
        po_number: null,
        line_items: [
          {
            id: "demo-1",
            sort_order: 0,
            description: "Custom metal fabrication",
            quantity: 1,
            unit_price: 180,
            amount: 180,
            metadata: {},
          },
          {
            id: "demo-2",
            sort_order: 1,
            description: "Powder coating",
            quantity: 1,
            unit_price: 70,
            amount: 70,
            metadata: {},
          },
        ],
        public_url: getPublicInvoiceUrl(publicId),
        payment_options: {
          accept_manual_ach: true,
          accept_stripe_card: true,
          accept_stripe_ach: true,
          accept_paypal: false,
          accept_venmo: false,
        },
      };
    }
    return null;
  }

  const invoiceRecord = invoice as InvoiceRecord;

  const { data: options, error: optionsError } = await supabase
    .from("invoice_payment_options")
    .select("accept_manual_ach, accept_stripe_card, accept_stripe_ach, accept_paypal, accept_venmo")
    .eq("invoice_id", invoiceRecord.id)
    .returns<PaymentOptionsRecord | null>()
    .maybeSingle();

  if (optionsError && optionsError.code !== "PGRST116") {
    throw optionsError;
  }

  const { data: businessProfile } = await supabase
    .from("business_profiles")
    .select("id, company_name, company_email, company_phone, company_website, manual_bank_instructions")
    .returns<BusinessProfileRecord | null>()
    .limit(1)
    .maybeSingle();

  const businessProfileRecord = businessProfile as BusinessProfileRecord | null;
  const metadata = invoiceRecord.metadata || {};
  const lineItems = await getInvoiceLineItems(invoiceRecord);
  const amountPaid = toNumber(invoiceRecord.amount_paid) ?? 0;
  const total = toNumber(invoiceRecord.total) ?? 0;
  const subtotal = toNumber(invoiceRecord.subtotal) ?? lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = toNumber(invoiceRecord.tax_amount) ?? 0;
  const amountDue = Math.max(Number((total - amountPaid).toFixed(2)), 0);
  const publicUrl = invoiceRecord.payment_page_url || getPublicInvoiceUrl(invoiceRecord.public_id);

  return {
    ...invoiceRecord,
    subtotal,
    tax_amount: taxAmount,
    total,
    amount_paid: amountPaid,
    amount_due: amountDue,
    manual_bank_instructions: businessProfileRecord?.manual_bank_instructions || null,
    business: {
      company_name: businessProfileRecord?.company_name || "S-Books",
      company_email: businessProfileRecord?.company_email || null,
      company_phone: businessProfileRecord?.company_phone || null,
      company_website: businessProfileRecord?.company_website || null,
    },
    customer: {
      billing_address: getCustomerAddress(metadata),
      company_name: getMetadataText(metadata, ["customer_company", "billing_company"]),
      contact_name: getMetadataText(metadata, ["customer_contact", "contact_name"]),
    },
    notes: getMetadataText(metadata, ["notes", "memo", "message"]),
    po_number: getMetadataText(metadata, ["po_number", "purchase_order", "po"]),
    line_items: lineItems,
    public_url: publicUrl,
    payment_options: options || {
      accept_manual_ach: true,
      accept_stripe_card: true,
      accept_stripe_ach: true,
      accept_paypal: false,
      accept_venmo: false,
    },
  };
}

export async function sendInvoiceEmail(publicId: string) {
  const invoice = await getInvoiceByPublicId(publicId);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  if (!invoice.customer_email) {
    throw new Error("Invoice customer email is missing.");
  }
  if (!invoice.public_url) {
    throw new Error("NEXT_PUBLIC_APP_BASE_URL is not configured for hosted invoice links.");
  }

  const resendKey = clean(process.env.RESEND_API_KEY);
  const from = clean(process.env.INVOICE_FROM_EMAIL);

  if (!resendKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  if (!from) {
    throw new Error("INVOICE_FROM_EMAIL is not configured.");
  }

  const resend = new Resend(resendKey);
  const subject = `${invoice.business.company_name} invoice ${invoice.invoice_number}`;
  const pdf = await generateInvoicePdf(invoice);
  const html = buildInvoiceEmailHtml(invoice);
  const text = buildInvoiceEmailText(invoice);

  const result = await resend.emails.send({
    from,
    to: invoice.customer_email,
    subject,
    html,
    text,
    attachments: [
      {
        filename: `${invoice.invoice_number}.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  });

  if (result.error) {
    await logInvoiceEmailDelivery({
      invoiceId: invoice.id,
      recipientEmail: invoice.customer_email,
      subject,
      providerMessageId: null,
      status: "failed",
      body: result.error as unknown as Record<string, unknown>,
    });
    throw new Error(result.error.message || "Invoice email failed.");
  }

  await logInvoiceEmailDelivery({
    invoiceId: invoice.id,
    recipientEmail: invoice.customer_email,
    subject,
    providerMessageId: result.data?.id || null,
    status: "queued",
    body: {
      public_id: invoice.public_id,
      public_url: invoice.public_url,
    },
  });

  return {
    id: result.data?.id || null,
    recipient: invoice.customer_email,
    subject,
  };
}

export async function recordStripeWebhookEvent(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const publicId = session.metadata?.public_id || null;

  const invoiceId = await findInvoiceIdByPublicId(publicId);

  const paymentEvent: PaymentEventInsert = {
    invoice_id: invoiceId,
    provider: "stripe",
    provider_event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
  };

  await insertPaymentEvent(paymentEvent);

  if (event.type === "checkout.session.completed" && invoiceId) {
    await markInvoicePaid(invoiceId, session.url || null);
  }
}

export async function recordPayPalOrderCapture(publicId: string, order: PayPalOrderResponse) {
  const invoiceId = await findInvoiceIdByPublicId(publicId);

  await insertPaymentEvent({
    invoice_id: invoiceId,
    provider: "paypal",
    provider_event_id: order.id,
    event_type: "PAYPAL.ORDER.CAPTURED",
    payload: order as unknown as Record<string, unknown>,
  });

  if (invoiceId) {
    await markInvoicePaid(invoiceId);
  }
}

export async function recordPayPalWebhookEvent(event: PayPalWebhookEvent) {
  const publicId = event.resource?.custom_id || null;
  const invoiceId = await findInvoiceIdByPublicId(publicId);

  await insertPaymentEvent({
    invoice_id: invoiceId,
    provider: "paypal",
    provider_event_id: event.id,
    event_type: event.event_type,
    payload: event as unknown as Record<string, unknown>,
  });

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && invoiceId) {
    await markInvoicePaid(invoiceId);
  }
}
