import { notFound, redirect } from "next/navigation";

import { getInvoiceByPublicId } from "@/lib/invoices";
import { acceptEstimateByToken, getEstimateByAcceptanceToken } from "@/lib/estimates";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ acceptanceToken: string }>;
  searchParams?: Promise<{ accepted?: string }>;
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

function isPaid(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === "paid";
}

export default async function AcceptEstimatePage({ params, searchParams }: PageProps) {
  const { acceptanceToken } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};
  const estimate = await getEstimateByAcceptanceToken(acceptanceToken);

  if (!estimate) notFound();

  const depositInvoice = estimate.deposit_invoice_public_id
    ? await getInvoiceByPublicId(estimate.deposit_invoice_public_id)
    : null;
  const depositIsPaid = Boolean(
    depositInvoice &&
      (isPaid(depositInvoice.payment_status) || isPaid(depositInvoice.status) || Number(depositInvoice.amount_due || 0) <= 0),
  );
  const accepted = Boolean(estimate.accepted_at);

  async function acceptAction(formData: FormData) {
    "use server";

    const result = await acceptEstimateByToken(acceptanceToken, {
      acceptedByName: String(formData.get("name") || ""),
      acceptedByEmail: String(formData.get("email") || ""),
    });

    if (result.depositInvoicePublicId) {
      redirect(`/invoice/${result.depositInvoicePublicId}`);
    }

    redirect(`/accept-estimate/${acceptanceToken}?accepted=1`);
  }

  return (
    <main className="shell">
      {resolvedSearch?.accepted ? (
        <section className="card" style={{ marginBottom: 18, borderColor: "#b8e0c6", background: "#f2fbf7" }}>
          <div className="eyebrow" style={{ color: "#0e8d63" }}>Estimate accepted</div>
          <div className="details">Your approval is on file. Continue below if the deposit invoice is still open.</div>
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
          <div className="hero-title">{estimate.invoice_number}</div>
          <div className="hero-subtitle">{estimate.business.company_name} quote portal for {estimate.customer_name}</div>
        </div>
      </section>

      <section className="invoice-portal-layout">
        <article className="card">
          <div className="invoice-topbar">
            <div>
              <div className="eyebrow">Estimate total</div>
              <div className="amount">{formatMoney(estimate.total, estimate.currency || "USD")}</div>
            </div>
            <div className="invoice-status-stack">
              <span className={`pill invoice-status-pill status-${String(estimate.status || "draft").replace(/\s+/g, "-").toLowerCase()}`}>
                {estimate.status}
              </span>
            </div>
          </div>

          <div className="invoice-summary-grid">
            <div className="card inset">
              <div className="eyebrow">From</div>
              <div className="invoice-block-title">{estimate.business.company_name}</div>
              {estimate.business.company_email ? <div className="copy">{estimate.business.company_email}</div> : null}
              {estimate.business.company_phone ? <div className="copy">{estimate.business.company_phone}</div> : null}
              {estimate.business.company_website ? <div className="copy">{estimate.business.company_website}</div> : null}
            </div>

            <div className="card inset">
              <div className="eyebrow">Quoted to</div>
              <div className="invoice-block-title">{estimate.customer.company_name || estimate.customer_name}</div>
              {estimate.customer.contact_name ? <div className="copy">{estimate.customer.contact_name}</div> : null}
              {estimate.customer.billing_address ? <div className="copy invoice-prewrap">{estimate.customer.billing_address}</div> : null}
              {estimate.customer_email ? <div className="copy">{estimate.customer_email}</div> : null}
            </div>
          </div>

          <div className="invoice-summary-grid invoice-summary-grid-tight">
            <div className="card inset">
              <div className="eyebrow">Estimate details</div>
              <div className="meta-list">
                <div className="meta-row">
                  <span className="option-label">Issue date</span>
                  <span>{formatDate(estimate.issue_date)}</span>
                </div>
                <div className="meta-row">
                  <span className="option-label">Valid through</span>
                  <span>{formatDate(estimate.due_date)}</span>
                </div>
                {estimate.terms ? (
                  <div className="meta-row">
                    <span className="option-label">Terms</span>
                    <span>{estimate.terms}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card inset">
              <div className="eyebrow">Approval path</div>
              <div className="meta-list">
                <div className="meta-row">
                  <span className="option-label">Step 1</span>
                  <span>Accept quote</span>
                </div>
                <div className="meta-row">
                  <span className="option-label">Step 2</span>
                  <span>{estimate.deposit ? `Pay ${formatMoney(estimate.deposit.targetTotal, estimate.currency || "USD")} deposit` : "No deposit required"}</span>
                </div>
              </div>
            </div>
          </div>

          <section className="invoice-line-items">
            <div className="section-header">
              <div>
                <div className="eyebrow">Estimate items</div>
                <div className="section-title">Quoted scope and totals</div>
              </div>
            </div>

            <div className="invoice-line-item-header">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit</span>
              <span>Total</span>
            </div>

            <div className="invoice-line-item-list">
              {estimate.line_items.map((item) => (
                <div key={item.id} className="invoice-line-item-row">
                  <div className="invoice-line-item-description">
                    <strong>{item.description}</strong>
                  </div>
                  <div>{item.quantity}</div>
                  <div>{item.unit_price !== null ? formatMoney(item.unit_price, estimate.currency) : "-"}</div>
                  <div>{formatMoney(item.amount, estimate.currency)}</div>
                </div>
              ))}
            </div>

            <div className="invoice-total-stack">
              <div className="invoice-total-row"><span>Subtotal</span><strong>{formatMoney(estimate.subtotal, estimate.currency)}</strong></div>
              <div className="invoice-total-row"><span>Tax</span><strong>{formatMoney(estimate.tax_amount, estimate.currency)}</strong></div>
              <div className="invoice-total-row invoice-total-row-emphasis"><span>Estimate total</span><strong>{formatMoney(estimate.total, estimate.currency)}</strong></div>
            </div>
          </section>

          {estimate.notes ? (
            <section className="card inset" style={{ marginTop: 18 }}>
              <div className="eyebrow">Notes</div>
              <div className="copy invoice-prewrap">{estimate.notes}</div>
            </section>
          ) : null}
        </article>

        <aside className="card muted">
          {depositIsPaid ? (
            <>
              <div className="eyebrow">Deposit received</div>
              <div className="section-title">You are all set</div>
              <div className="details">
                The deposit for {estimate.invoice_number} has been paid. {estimate.business.company_name} has been notified.
              </div>
              {depositInvoice ? (
                <div className="cta-row">
                  <a className="btn primary" href={`/invoice/${depositInvoice.public_id}`}>View paid deposit invoice</a>
                </div>
              ) : null}
            </>
          ) : accepted && depositInvoice ? (
            <>
              <div className="eyebrow">Deposit ready</div>
              <div className="section-title">Continue to payment</div>
              <div className="details">
                Your approval is on file. Finish the required deposit to lock in the project.
              </div>
              <div className="card inset" style={{ marginTop: 18 }}>
                <div className="eyebrow">Deposit invoice</div>
                <div className="amount" style={{ marginTop: 10 }}>{formatMoney(depositInvoice.amount_due, depositInvoice.currency || estimate.currency)}</div>
                <div className="copy">{depositInvoice.invoice_number}</div>
              </div>
              <div className="cta-row">
                <a className="btn primary" href={`/invoice/${depositInvoice.public_id}`}>Pay deposit</a>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow">Accept this estimate</div>
              <div className="section-title">Approve and continue</div>
              <div className="details">
                Confirm the project and we will take you straight to the deposit invoice.
              </div>

              {estimate.deposit ? (
                <div className="card inset" style={{ marginTop: 18 }}>
                  <div className="eyebrow">Deposit due on acceptance</div>
                  <div className="amount" style={{ marginTop: 10 }}>{formatMoney(estimate.deposit.targetTotal, estimate.currency || "USD")}</div>
                  <div className="copy">{estimate.deposit.summary}</div>
                </div>
              ) : null}

              <form action={acceptAction} className="receipt-form" style={{ marginTop: 18 }}>
                <label className="field">
                  <span>Name</span>
                  <input name="name" type="text" defaultValue={estimate.customer.contact_name || estimate.customer_name} required />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input name="email" type="email" defaultValue={estimate.customer_email || ""} />
                </label>
                <button className="btn primary" type="submit">Accept and continue</button>
              </form>
            </>
          )}

          <div className="footer-note payment-contact">
            Questions? Contact {estimate.business.company_name}
            {estimate.business.company_email ? ` at ${estimate.business.company_email}` : ""}.
          </div>
        </aside>
      </section>
    </main>
  );
}
