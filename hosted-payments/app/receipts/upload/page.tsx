import { ReceiptUploadForm } from "@/components/receipt-upload-form";

export default function ReceiptUploadPage() {
  return (
    <main className="shell shell-wide">
      <section className="hero">
        <div>
          <div className="eyebrow">Upload</div>
          <div className="hero-title">Receipt intake</div>
          <div className="hero-subtitle">Drop a receipt, send it to the backend, and move directly into review.</div>
        </div>
      </section>

      <section className="grid two receipt-grid">
        <article className="card">
          <div className="eyebrow">Drag and drop</div>
          <div className="receipt-title">Send files to ingestion</div>
          <p className="copy">
            The upload API stores the file, hands off parsing when available, and places the receipt in the review queue.
          </p>
          <ReceiptUploadForm />
        </article>

        <aside className="card muted">
          <div className="eyebrow">Workflow</div>
          <div className="details">
            <div>1. Stores the file in the Supabase <code>receipts</code> bucket.</div>
            <div>2. Creates or updates a row in <code>receipts</code>.</div>
            <div>3. Persists file metadata in <code>receipt_files</code>.</div>
            <div>4. Leaves the record in <code>needs_review</code> unless confidence is high.</div>
          </div>
          <div className="cta-row">
            <a className="btn secondary" href="/receipts">Open receipt inbox</a>
          </div>
        </aside>
      </section>
    </main>
  );
}
