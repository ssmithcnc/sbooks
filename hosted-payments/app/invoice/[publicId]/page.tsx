import Link from "next/link";
import { notFound } from "next/navigation";

import { getInvoiceByPublicId } from "@/lib/invoices";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function InvoicePage({ params }: PageProps) {
  const { publicId } = await params;
  const invoice = await getInvoiceByPublicId(publicId);

  if (!invoice) notFound();

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: invoice.currency ?? "USD"
  }).format(Number(invoice.total || 0));

  return (
    <main className="shell">
      <section className="hero">
        <div className="brand-mark" aria-hidden="true">
          <div className="brand-mark-text">
            <strong>S</strong>
            <span>books</span>
          </div>
        </div>
        <div>
          <div className="hero-title">{invoice.invoice_number}</div>
          <div className="hero-subtitle">Hosted invoice payment page for {invoice.customer_name}</div>
        </div>
      </section>

      <section className="grid two">
        <article className="card">
          <div className="eyebrow">Amount due</div>
          <div className="amount">{money}</div>
          <div className="meta-list">
            <div className="meta-row">
              <span className="option-label">Issue date</span>
              <span>{invoice.issue_date}</span>
            </div>
            <div className="meta-row">
              <span className="option-label">Due date</span>
              <span>{invoice.due_date || "Due on receipt"}</span>
            </div>
            <div className="meta-row">
              <span className="option-label">Customer</span>
              <span>{invoice.customer_name}</span>
            </div>
          </div>
          <div className="cta-row">
            {invoice.payment_options.accept_stripe_card ? (
              <form action="/api/stripe/create-checkout-session" method="post">
                <input type="hidden" name="publicId" value={publicId} />
                <input type="hidden" name="paymentMethod" value="card" />
                <button className="btn primary" type="submit">Pay with card</button>
              </form>
            ) : null}
            {invoice.payment_options.accept_stripe_ach ? (
              <form action="/api/stripe/create-checkout-session" method="post">
                <input type="hidden" name="publicId" value={publicId} />
                <input type="hidden" name="paymentMethod" value="us_bank_account" />
                <button className="btn secondary" type="submit">Pay by ACH</button>
              </form>
            ) : null}
          </div>
        </article>

        <aside className="card muted">
          <div className="eyebrow">Payment options</div>
          <div className="option-list">
            <div className="option">
              <div>
                <div className="option-label">Manual bank transfer</div>
                <div className="option-copy">
                  {invoice.payment_options.accept_manual_ach
                    ? "Show ACH instructions for large invoices and fee-free payments."
                    : "Manual ACH is disabled for this invoice."}
                </div>
              </div>
              <div>{invoice.payment_options.accept_manual_ach ? <span className="pill">Enabled</span> : null}</div>
            </div>
            <div className="option">
              <div>
                <div className="option-label">Stripe cards</div>
                <div className="option-copy">Card checkout for standard online payments.</div>
              </div>
              <div>{invoice.payment_options.accept_stripe_card ? <span className="pill">Enabled</span> : null}</div>
            </div>
            <div className="option">
              <div>
                <div className="option-label">Stripe ACH debit</div>
                <div className="option-copy">Online bank transfer flow through Stripe.</div>
              </div>
              <div>{invoice.payment_options.accept_stripe_ach ? <span className="pill">Enabled</span> : null}</div>
            </div>
          </div>

          {invoice.payment_options.accept_manual_ach && invoice.manual_bank_instructions ? (
            <div className="details">
              <div className="option-label">Bank transfer instructions</div>
              <div>{invoice.manual_bank_instructions}</div>
            </div>
          ) : null}

          <div className="footer-note">
            Questions? Contact {invoice.business.company_name}
            {invoice.business.company_email ? ` at ${invoice.business.company_email}` : ""}.
          </div>
        </aside>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Temporary scaffold</div>
        <div className="details">
          This page is wired to Supabase and Stripe helpers, but it still needs live project keys,
          webhook setup, and desktop invoice sync before payments can go fully live.
        </div>
        <div className="cta-row">
          <Link className="btn secondary" href="/">Back to overview</Link>
        </div>
      </section>
    </main>
  );
}
