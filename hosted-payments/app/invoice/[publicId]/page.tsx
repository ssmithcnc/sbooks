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

function cleanStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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

  const amountDue = Number(invoice.amount_due || 0);
  const invoiceIsPaid =
    cleanStatus(invoice.payment_status) === "paid" ||
    cleanStatus(invoice.status) === "paid" ||
    amountDue <= 0;
  const money = formatMoney(amountDue, invoice.currency ?? "USD");
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
  const hasWalletCheckout = Boolean((paymentOptions.accept_paypal || paymentOptions.accept_venmo) && paypalClientId);
  const walletMethodLabel =
    paymentOptions.accept_paypal && paymentOptions.accept_venmo
      ? "PayPal or Venmo"
      : paymentOptions.accept_venmo
        ? "Venmo"
        : "PayPal";
  const hasOnlinePaymentMethods =
    paymentOptions.accept_stripe_card || paymentOptions.accept_stripe_ach || hasWalletCheckout;

  return (
    <main className="shell">
      {resolvedSearch?.paid ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#b8e0c6", background: "#f2fbf7" }}>
          <div className="eyebrow" style={{ color: "#0e8d63" }}>Payment received</div>
          <div className="details">
            {resolvedSearch?.provider === "paypal"
              ? "PayPal returned this payment as successful. S-Books will reflect the webhook update after PayPal posts it."
              : "Stripe sent this payment back as successful. S-Books will reflect the webhook update after Stripe posts it."}
          </div>
        </section>
      ) : null}
      {resolvedSearch?.canceled ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#f1d19a", background: "#fff8ed" }}>
          <div className="eyebrow" style={{ color: "#a16207" }}>Checkout canceled</div>
          <div className="details">No payment was submitted. You can try again whenever you are ready.</div>
        </section>
      ) : null}
      {resolvedSearch?.error ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#efb7b7", background: "#fff4f4" }}>
          <div className="eyebrow" style={{ color: "#b42318" }}>Checkout error</div>
          <div className="details">{resolvedSearch.error}</div>
        </section>
      ) : null}
      {resolvedSearch?.emailed ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#9ecaff", background: "#eef6ff" }}>
          <div className="eyebrow" style={{ color: "#15428e" }}>Invoice email sent</div>
          <div className="details">The branded invoice email was queued successfully.</div>
        </section>
      ) : null}
      {resolvedSearch?.emailError ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#efb7b7", background: "#fff4f4" }}>
          <div className="eyebrow" style={{ color: "#b42318" }}>Invoice email failed</div>
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
          {invoiceIsPaid ? (
            <>
              <div className="eyebrow">Payment received</div>
              <div className="section-title">This invoice is settled</div>
              <div className="details">
                We have recorded the full payment for {invoice.invoice_number}. Keep this page for your records or download the PDF from the invoice details.
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow">Pay this invoice</div>
              <div className="section-title">Payment options</div>

              {hasOnlinePaymentMethods ? (
                <div className="payment-method-stack">
                  {paymentOptions.accept_stripe_card ? (
                    <form className="payment-method-form" action="/api/stripe/create-checkout-session" method="post">
                      <input type="hidden" name="publicId" value={publicId} />
                      <input type="hidden" name="paymentMethod" value="card" />
                      <button className="payment-method-button" type="submit">
                        <span className="payment-method-chevron" aria-hidden="true">{">"}</span>
                        <span className="payment-method-copy">
                          <span className="payment-method-title">Credit Card</span>
                        </span>
                        <span className="payment-brand-cluster" aria-hidden="true">
                          <span className="payment-brand-badge payment-brand-badge-card">VISA</span>
                          <span className="payment-brand-badge payment-brand-badge-card">MC</span>
                          <span className="payment-brand-badge payment-brand-badge-card">AMEX</span>
                          <span className="payment-brand-badge payment-brand-badge-card">DISC</span>
                        </span>
                      </button>
                    </form>
                  ) : null}
                  {paymentOptions.accept_stripe_ach ? (
                    <form className="payment-method-form" action="/api/stripe/create-checkout-session" method="post">
                      <input type="hidden" name="publicId" value={publicId} />
                      <input type="hidden" name="paymentMethod" value="us_bank_account" />
                      <button className="payment-method-button" type="submit">
                        <span className="payment-method-chevron" aria-hidden="true">{">"}</span>
                        <span className="payment-method-copy">
                          <span className="payment-method-title">Bank Transfer (ACH)</span>
                        </span>
                        <span className="payment-brand-cluster" aria-hidden="true">
                          <span className="payment-brand-badge payment-brand-badge-ach">ACH</span>
                        </span>
                      </button>
                    </form>
                  ) : null}
                  {hasWalletCheckout ? (
                    <PayPalButtons
                      clientId={paypalClientId}
                      publicId={publicId}
                      currency={invoice.currency || "USD"}
                      showVenmo={Boolean(paymentOptions.accept_venmo)}
                      methodLabel={walletMethodLabel}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="details">
                  Contact {invoice.business.company_name}
                  {invoice.business.company_email ? ` at ${invoice.business.company_email}` : ""} to arrange payment.
                </div>
              )}

              {paymentOptions.accept_manual_ach && invoice.manual_bank_instructions ? (
                <div className="payment-support-block">
                  <div className="eyebrow">Manual bank transfer</div>
                  <div className="copy invoice-prewrap">{invoice.manual_bank_instructions}</div>
                </div>
              ) : null}
            </>
          )}

          <div className="footer-note payment-contact">
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
    </main>
  );
}
