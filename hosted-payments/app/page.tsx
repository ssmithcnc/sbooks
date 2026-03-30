import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <div>
          <div className="eyebrow">Receipts</div>
          <div className="hero-title">Receipt ingestion and review</div>
          <div className="hero-subtitle">
            Dark-theme intake dashboard for email, uploads, parsing, and approval workflow.
          </div>
        </div>
      </section>

      <section className="grid two">
        <article className="card">
          <div className="eyebrow">Workflow</div>
          <div className="invoice-number">Ingestion first. Review fast.</div>
          <p className="copy">
            This app now centers the receipt review queue, upload flow, and approval actions. Job costing can layer on later without changing the intake path.
          </p>
          <div className="cta-row">
            <Link className="btn primary" href="/receipts">Open receipt inbox</Link>
            <Link className="btn secondary" href="/receipts/upload">Upload a receipt</Link>
          </div>
        </article>

        <aside className="card muted">
          <div className="eyebrow">Backends</div>
          <div className="details">
            <div>1. Apply <code>supabase/schema.sql</code> so receipt review tables exist.</div>
            <div>2. Deploy <code>supabase/functions/parse-receipt-email</code> for email intake.</div>
            <div>3. Run <code>services/pdf-extractor</code> and set <code>PDF_SERVICE_URL</code>.</div>
            <div>4. Set the hosted app Supabase keys and optional edge function URL.</div>
          </div>
        </aside>
      </section>
    </main>
  );
}
