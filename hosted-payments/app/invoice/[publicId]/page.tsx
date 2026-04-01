import { notFound } from "next/navigation";

import { PayPalButtons } from "@/components/paypal-buttons";
import { getInvoiceByPublicId } from "@/lib/invoices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ publicId: string }>;
  searchParams?: Promise<{
    paid?: string;
    canceled?: string;
    error?: string;
    provider?: string;
    manage?: string;
    emailed?: string;
    emailError?: string;
  }>;
};

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Due on receipt";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function metadataFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

export default async function InvoicePage({ params, searchParams }: PageProps) {
  const { publicId } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};
  const invoice = await getInvoiceByPublicId(publicId);

  if (!invoice) notFound();

  const money = formatMoney(Number(invoice.amount_due || 0), invoice.currency ?? "USD");
  const subtotal = formatMoney(Number(invoice.subtotal || 0), invoice.currency ?? "USD");
  const tax = formatMoney(Number(invoice.tax_amount || 0), invoice.currency ?? "USD");
  const paid = formatMoney(Number(invoice.amount_paid || 0), invoice.currency ?? "USD");
  const paypalClientId = process.env.PAYPAL_CLIENT_ID || "";
  const adminToken = String(process.env.INVOICE_ADMIN_TOKEN || "").trim();
  const showAdminTools = Boolean(adminToken && resolvedSearch?.manage === adminToken);
  const paymentOptions = invoice.payment_options ?? {
    accept_manual_ach: true,
    accept_stripe_card: true,
    accept_stripe_ach: true,
    accept_paypal: false,
    accept_venmo: false,
  };
  const showPortalExperience = metadataFlag(invoice.metadata?.use_full_portal);

  return (
    <main className="shell">
      {resolvedSearch?.paid ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#b8e0c6", background: "rgba(11, 49, 34, 0.92)" }}>
          <div className="eyebrow" style={{ color: "#74efb8" }}>Payment received</div>
          <div className="details">
            {resolvedSearch?.provider === "paypal"
              ? "PayPal returned this payment as successful. S-Books will reflect the webhook update after PayPal posts it."
              : "Stripe sent this payment back as successful. S-Books will reflect the webhook update after Stripe posts it."}
          </div>
        </section>
      ) : null}
      {resolvedSearch?.canceled ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#f1d19a", background: "rgba(57, 39, 10, 0.92)" }}>
          <div className="eyebrow" style={{ color: "#ffcf70" }}>Checkout canceled</div>
          <div className="details">No payment was submitted. You can try again whenever you are ready.</div>
        </section>
      ) : null}
      {resolvedSearch?.error ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#efb7b7", background: "rgba(61, 20, 20, 0.92)" }}>
          <div className="eyebrow" style={{ color: "#ff9c9c" }}>Checkout error</div>
          <div className="details">{resolvedSearch.error}</div>
        </section>
      ) : null}
      {resolvedSearch?.emailed ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#9ecaff", background: "rgba(14, 31, 56, 0.92)" }}>
          <div className="eyebrow" style={{ color: "#9ecaff" }}>Invoice email sent</div>
          <div className="details">The branded invoice email was queued successfully.</div>
        </section>
      ) : null}
      {resolvedSearch?.emailError ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#efb7b7", background: "rgba(61, 20, 20, 0.92)" }}>
          <div className="eyebrow" style={{ color: "#ff9c9c" }}>Invoice email failed</div>
          <div className="details">{resolvedSearch.emailError}</div>
        </section>
      ) : null}

      <section className="hero">
        <div className="brand-mark" aria-hidden="true">
          <div className="brand-mark-text">
            <strong>S</strong>
            <span>books</span>
          </div>
        </div>
        <div>
          <div className="hero-title">{invoice.invoice_number}</div>
          <div className="hero-subtitle">{invoice.business.company_name} billing portal for {invoice.customer_name}</div>
        </div>
      </section>

      <section className={showPortalExperience ? "invoice-portal-layout" : "grid two"}>
        <article className="card">
          <div className="invoice-topbar">
            <div>
              <div className="eyebrow">Amount due</div>
              <div className="amount">{money}</div>
            </div>
            <div className="invoice-status-stack">
              <span className={`pill invoice-status-pill status-${invoice.payment_status.replace(/\s+/g, "-").toLowerCase()}`}>{invoice.payment_status}</span>
              <span className={`pill invoice-status-pill status-${invoice.status.replace(/\s+/g, "-").toLowerCase()}`}>{invoice.status}</span>
            </div>
          </div>

          <div className="invoice-summary-grid">
            <div className="card inset">
              <div className="eyebrow">From</div>
              <div className="invoice-block-title">{invoice.business.company_name}</div>
              {invoice.business.company_email ? <div className="copy">{invoice.business.company_email}</div> : null}
              {invoice.business.company_phone ? <div className="copy">{invoice.business.company_phone}</div> : null}
              {invoice.business.company_website ? <div className="copy">{invoice.business.company_website}</div> : null}
            </div>

            <div className="card inset">
              <div className="eyebrow">Bill to</div>
              <div className="invoice-block-title">{invoice.customer.company_name || invoice.customer_name}</div>
              {invoice.customer.contact_name ? <div className="copy">{invoice.customer.contact_name}</div> : null}
              {invoice.customer.billing_address ? <div className="copy invoice-prewrap">{invoice.customer.billing_address}</div> : null}
              {invoice.customer_email ? <div className="copy">{invoice.customer_email}</div> : null}
            </div>
          </div>

          {showPortalExperience ? (
            <div className="invoice-summary-grid invoice-summary-grid-tight">
              <div className="card inset">
                <div className="eyebrow">Invoice details</div>
                <div className="meta-list">
                  <div className="meta-row">
                    <span className="option-label">Issue date</span>
                    <span>{formatDate(invoice.issue_date)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="option-label">Due date</span>
                    <span>{formatDate(invoice.due_date)}</span>
                  </div>
                  {invoice.po_number ? (
                    <div className="meta-row">
                      <span className="option-label">PO number</span>
                      <span>{invoice.po_number}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="card inset">
                <div className="eyebrow">Downloads</div>
                <div className="cta-row">
                  <a className="btn secondary" href={`/api/invoice/${publicId}/pdf`}>Download PDF</a>
                  <a className="btn secondary" href={`/api/invoice/${publicId}/csv`}>Download CSV</a>
                </div>
                <div className="footer-note">Use the hosted page for payment and the downloads for accounting import or records.</div>
              </div>
            </div>
          ) : (
            <div className="card inset" style={{ marginTop: 18 }}>
              <div className="eyebrow">Invoice details</div>
              <div className="meta-list">
                <div className="meta-row">
                  <span className="option-label">Issue date</span>
                  <span>{formatDate(invoice.issue_date)}</span>
                </div>
                <div className="meta-row">
                  <span className="option-label">Due date</span>
                  <span>{formatDate(invoice.due_date)}</span>
                </div>
                {invoice.po_number ? (
                  <div className="meta-row">
                    <span className="option-label">PO number</span>
                    <span>{invoice.po_number}</span>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <section className="invoice-line-items">
            <div className="section-header">
              <div>
                <div className="eyebrow">Invoice items</div>
                <div className="section-title">{showPortalExperience ? "Line items and totals" : "Invoice summary"}</div>
              </div>
            </div>

            <div className="invoice-line-item-header">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit</span>
              <span>Total</span>
            </div>

            <div className="invoice-line-item-list">
              {invoice.line_items.map((item) => (
                <div key={item.id} className="invoice-line-item-row">
                  <div className="invoice-line-item-description">
                    <strong>{item.description}</strong>
                  </div>
                  <div>{item.quantity}</div>
                  <div>{item.unit_price !== null ? formatMoney(item.unit_price, invoice.currency) : "-"}</div>
                  <div>{formatMoney(item.amount, invoice.currency)}</div>
                </div>
              ))}
            </div>

            <div className="invoice-total-stack">
              <div className="invoice-total-row"><span>Subtotal</span><strong>{subtotal}</strong></div>
              <div className="invoice-total-row"><span>Tax</span><strong>{tax}</strong></div>
              <div className="invoice-total-row"><span>Paid</span><strong>{paid}</strong></div>
              <div className="invoice-total-row invoice-total-row-emphasis"><span>Amount due</span><strong>{money}</strong></div>
            </div>
          </section>

          {invoice.notes ? (
            <section className="card inset" style={{ marginTop: 18 }}>
              <div className="eyebrow">Notes</div>
              <div className="copy invoice-prewrap">{invoice.notes}</div>
            </section>
          ) : null}
        </article>

        <aside className="card muted">
          <div className="eyebrow">Pay this invoice</div>
          <div className="section-title">{showPortalExperience ? "Choose the fastest payment path" : "Simple invoice payment"}</div>
          {showPortalExperience ? (
            <div className="option-list" style={{ marginTop: 14 }}>
              <div className="option">
                <div>
                  <div className="option-label">Stripe cards</div>
                  <div className="option-copy">Pay online with a standard card checkout flow.</div>
                </div>
                <div>{paymentOptions.accept_stripe_card ? <span className="pill">Enabled</span> : null}</div>
              </div>
              <div className="option">
                <div>
                  <div className="option-label">Stripe ACH debit</div>
                  <div className="option-copy">Use online bank payment when ACH is enabled for the invoice.</div>
                </div>
                <div>{paymentOptions.accept_stripe_ach ? <span className="pill">Enabled</span> : null}</div>
              </div>
              <div className="option">
                <div>
                  <div className="option-label">PayPal / Venmo</div>
                  <div className="option-copy">PayPal checkout with Venmo support where eligible.</div>
                </div>
                <div>{(paymentOptions.accept_paypal || paymentOptions.accept_venmo) ? <span className="pill">Enabled</span> : null}</div>
              </div>
            </div>
          ) : (
            <div className="details" style={{ marginTop: 14 }}>
              Use the button below to pay this invoice. For records, keep the invoice PDF attached to the original email.
            </div>
          )}

          <div className="cta-row">
            {paymentOptions.accept_stripe_card ? (
              <form action="/api/stripe/create-checkout-session" method="post">
                <input type="hidden" name="publicId" value={publicId} />
                <input type="hidden" name="paymentMethod" value="card" />
                <button className="btn primary" type="submit">Pay with card</button>
              </form>
            ) : null}
            {paymentOptions.accept_stripe_ach ? (
              <form action="/api/stripe/create-checkout-session" method="post">
                <input type="hidden" name="publicId" value={publicId} />
                <input type="hidden" name="paymentMethod" value="us_bank_account" />
                <button className="btn secondary" type="submit">Pay by ACH</button>
              </form>
            ) : null}
            {(paymentOptions.accept_paypal || paymentOptions.accept_venmo) && paypalClientId ? (
              <PayPalButtons
                clientId={paypalClientId}
                publicId={publicId}
                currency={invoice.currency || "USD"}
                showVenmo={Boolean(paymentOptions.accept_venmo)}
                buttonLabel={
                  paymentOptions.accept_paypal && paymentOptions.accept_venmo
                    ? "Pay with PayPal or Venmo"
                    : paymentOptions.accept_venmo
                      ? "Pay with Venmo"
                      : "Pay with PayPal"
                }
              />
            ) : null}
          </div>

          {paymentOptions.accept_manual_ach && invoice.manual_bank_instructions ? (
            <div className="details">
              <div className="option-label">Manual bank transfer instructions</div>
              <div className="invoice-prewrap">{invoice.manual_bank_instructions}</div>
            </div>
          ) : null}

          <div className="footer-note">
            Questions? Contact {invoice.business.company_name}
            {invoice.business.company_email ? ` at ${invoice.business.company_email}` : ""}.
          </div>

          {showAdminTools ? (
            <section className="card inset" style={{ marginTop: 18 }}>
              <div className="eyebrow">Admin tools</div>
              <div className="section-title">Email this invoice</div>
              <div className="details">This action sends the branded email with the hosted payment link and PDF attached.</div>
              <form action={`/api/invoice/${publicId}/send?token=${encodeURIComponent(adminToken)}`} method="post" style={{ marginTop: 16 }}>
                <button className="btn primary" type="submit">Send branded email</button>
              </form>
            </section>
          ) : null}
        </aside>
      </section>

      {showPortalExperience ? (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Customer portal</div>
          <div className="details">
            This invoice page now combines hosted payment buttons, PDF download, CSV export, and a shareable public invoice URL.
          </div>
        </section>
      ) : null}
    </main>
  );
}
