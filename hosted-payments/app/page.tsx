import Link from "next/link";

export default function HomePage() {
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
          <div className="hero-title">S-Books Hosted Payments</div>
          <div className="hero-subtitle">
            Public invoice pages, Stripe Checkout, webhooks, and cloud sync for the desktop app.
          </div>
        </div>
      </section>

      <section className="grid two">
        <article className="card">
          <div className="eyebrow">Ready for Vercel</div>
          <div className="invoice-number">Next step: connect the hosted app root</div>
          <p className="copy">
            This folder is the app Vercel should deploy. Once dependencies and environment variables are added,
            customers will be able to open hosted invoice pages instead of the local desktop URL.
          </p>
          <div className="cta-row">
            <Link className="btn primary" href="/invoice/demo-invoice">
              Open demo invoice page
            </Link>
            <Link className="btn secondary" href="/receipts">
              Open receipt library
            </Link>
            <Link className="btn secondary" href="/receipts/upload">
              Open receipt upload
            </Link>
          </div>
        </article>

        <aside className="card muted">
          <div className="eyebrow">Environment checklist</div>
          <div className="details">
            <div>1. Set Vercel Root Directory to <code>hosted-payments</code>.</div>
            <div>2. Add Supabase URL and keys.</div>
            <div>3. Add Stripe secret and webhook secret.</div>
            <div>4. Add PayPal client, secret, and webhook id.</div>
            <div>5. Apply <code>supabase/schema.sql</code> in Supabase.</div>
            <div>6. Open <code>/receipts/upload</code> from a phone to start building the receipt bucket.</div>
          </div>
        </aside>
      </section>
    </main>
  );
}
