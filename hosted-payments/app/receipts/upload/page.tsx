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

          {resolvedSearch?.uploaded === "1" ? (
            <div className="notice good">
              Receipt uploaded successfully.
              <div className="notice-detail">
                Receipt ID: {resolvedSearch.receipt} <br />
                Stored at: {resolvedSearch.path}
              </div>
            </div>
          ) : null}

          {resolvedSearch?.error ? (
            <div className="notice bad">
              {resolvedSearch.error}
            </div>
          ) : null}

          <form action="/api/receipts/upload" method="post" encType="multipart/form-data" className="receipt-form">
            <label className="field">
              <span>Receipt photo or PDF</span>
              <input type="file" name="receipt_file" accept="image/*,application/pdf" capture="environment" required />
            </label>
            <label className="field">
              <span>Vendor name</span>
              <input type="text" name="vendor_name" placeholder="Home Depot, Shell, UPS..." />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Receipt date</span>
                <input type="date" name="receipt_date" />
              </label>
              <label className="field">
                <span>Total amount</span>
                <input type="number" name="total_amount" step="0.01" min="0" placeholder="0.00" />
              </label>
            </div>
            <label className="field">
              <span>Contact email</span>
              <input type="email" name="contact_email" placeholder="Optional follow-up contact" />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea name="notes" rows={4} placeholder="Job name, customer, card used, or any note that helps bucket it later." />
            </label>
            <div className="cta-row">
              <button className="btn primary" type="submit">Upload receipt</button>
            </div>
          </form>
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
        </aside>
      </section>
    </main>
  );
}
