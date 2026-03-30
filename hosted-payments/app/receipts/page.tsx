import Link from "next/link";

import { listReceiptUploads } from "@/lib/receipts";
import { ReceiptDeleteButton } from "@/components/receipt-delete-button";

export const dynamic = "force-dynamic";

function formatCurrency(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Unknown";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function ReceiptsIndexPage() {
  const receipts = await listReceiptUploads(100);

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
          <div className="hero-title">Receipt Library</div>
          <div className="hero-subtitle">
            Every phone image and laptop PDF uploaded into the S-Books receipts bucket.
          </div>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <div className="receipt-toolbar">
            <div>
              <div className="eyebrow">Cloud bucket</div>
              <div className="receipt-title">Recent uploads</div>
            </div>
            <div className="cta-row">
              <Link className="btn secondary" href="/receipts/upload">
                Upload another receipt
              </Link>
            </div>
          </div>

          {receipts.length ? (
            <div className="receipt-list">
              {receipts.map((receipt) => (
                <article className="receipt-item" key={receipt.id}>
                  <div className="receipt-preview">
                    {receipt.signed_url && receipt.is_image ? (
                      <img
                        className="receipt-thumb"
                        src={receipt.signed_url}
                        alt={receipt.original_name}
                      />
                    ) : (
                      <div className="receipt-file-pill">
                        {receipt.is_pdf ? "PDF" : "FILE"}
                      </div>
                    )}
                  </div>

                  <div className="receipt-meta">
                    <div className="receipt-headline">
                      <strong>{receipt.vendor_name || "Unlabeled receipt"}</strong>
                      <span className="pill">{receipt.status}</span>
                    </div>
                    <div className="details">
                      <div>Uploaded: {formatDate(receipt.created_at)}</div>
                      <div>Receipt date: {receipt.receipt_date || "Unknown"}</div>
                      <div>Total: {formatCurrency(receipt.total_amount)}</div>
                      <div>File: {receipt.original_name}</div>
                      <div>Path: {receipt.object_path}</div>
                    </div>
                    <div className="cta-row">
                      {receipt.signed_url ? (
                        <a className="btn primary" href={receipt.signed_url} target="_blank" rel="noopener">
                          Open file
                        </a>
                      ) : null}
                      <ReceiptDeleteButton receiptId={receipt.id} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="notice bad">
              No receipts found yet. Upload one from your phone or laptop to populate this library.
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
