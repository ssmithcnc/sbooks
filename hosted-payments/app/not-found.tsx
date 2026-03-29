import Link from "next/link";

export default function NotFound() {
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
          <div className="hero-title">Invoice not found</div>
          <div className="hero-subtitle">This hosted payment link does not match a live invoice yet.</div>
        </div>
      </section>
      <section className="card" style={{ marginTop: 20 }}>
        <div className="details">
          Once the desktop app publishes invoices to Supabase, this page will show the matching invoice and payment options.
        </div>
        <div className="cta-row">
          <Link className="btn secondary" href="/">Back to S-Books hosted payments</Link>
        </div>
      </section>
    </main>
  );
}
