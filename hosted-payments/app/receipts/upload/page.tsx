import { ReceiptUploadForm } from "@/components/receipt-upload-form";

type SearchParams = {
  uploaded?: string;
  receipt?: string;
  path?: string;
  error?: string;
};

export default async function ReceiptUploadPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearch = searchParams ? await searchParams : {};

  return (
    <main className="shell shell-narrow">
      <section className="hero">
        <div className="brand-mark" aria-hidden="true">
          <div className="brand-mark-text">
            <strong>S</strong>
            <span>books</span>
          </div>
        </div>
        <div>
          <div className="hero-title">Receipt Capture</div>
          <div className="hero-subtitle">
            Snap or upload receipts from your phone and drop them straight into the S-Books cloud bucket.
          </div>
        </div>
      </section>

      <section className="grid two receipt-grid">
        <article className="card">
          <div className="eyebrow">Mobile upload</div>
          <div className="receipt-title">Upload a new receipt</div>
          <p className="copy">
            This first version stores the file and the basic receipt details so we can layer OCR and email intake on top next.
          </p>

          <ReceiptUploadForm
            initialUploaded={resolvedSearch?.uploaded === "1"}
            initialReceiptId={resolvedSearch?.receipt}
            initialPath={resolvedSearch?.path}
            initialError={resolvedSearch?.error}
          />
        </article>

        <aside className="card muted">
          <div className="eyebrow">What this does now</div>
          <div className="details">
            <div>1. Stores the file in the Supabase <code>receipts</code> bucket.</div>
            <div>2. Creates a row in <code>receipt_uploads</code> with vendor/date/amount metadata.</div>
            <div>3. Leaves room for OCR, category rules, and email intake next.</div>
          </div>
          <div className="footer-note">
            Best results on a phone: open this page, take a photo, then upload it immediately after the purchase.
          </div>
          <div className="cta-row">
            <a className="btn secondary" href="/receipts">
              View all uploaded receipts
            </a>
          </div>
        </aside>
      </section>
    </main>
  );
}
