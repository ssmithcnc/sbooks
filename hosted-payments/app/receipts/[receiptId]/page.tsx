import Link from "next/link";
import { notFound } from "next/navigation";

import { ReceiptReviewForm } from "@/components/receipt-review-form";
import { getReceiptById } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function ReceiptReviewPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const { receiptId } = await params;

  let receipt;
  try {
    receipt = await getReceiptById(receiptId);
  } catch {
    notFound();
  }

  return (
    <main className="shell shell-wide">
      <section className="hero">
        <div>
          <div className="eyebrow">Review</div>
          <div className="hero-title">{receipt.vendor || "Receipt review"}</div>
          <div className="hero-subtitle">Source preview on the left, editable receipt data on the right.</div>
        </div>
      </section>

      <section className="review-layout">
        <article className="card review-preview">
          <div className="section-header">
            <div>
              <div className="eyebrow">Source file</div>
              <div className="section-title">{receipt.primary_file?.original_name || "Uploaded receipt"}</div>
            </div>
            <div className="cta-row">
              <Link className="btn secondary" href="/receipts">Back to inbox</Link>
              {receipt.primary_file?.signed_url ? (
                <a className="btn primary" href={receipt.primary_file.signed_url} rel="noopener" target="_blank">
                  Open full file
                </a>
              ) : null}
            </div>
          </div>

          <div className="receipt-meta-grid">
            <div><span>Uploaded</span><strong>{formatDate(receipt.created_at)}</strong></div>
            <div><span>Status</span><strong>{receipt.status.replace("_", " ")}</strong></div>
            <div><span>Confidence</span><strong>{Math.round((receipt.confidence || 0) * 100)}%</strong></div>
            <div><span>Source</span><strong>{receipt.source}</strong></div>
            <div><span>Expense category</span><strong>{receipt.expense_category || "Not set"}</strong></div>
            <div><span>Pages to keep</span><strong>{receipt.pages_to_keep || "Not set"}</strong></div>
          </div>

          <div className="document-frame">
            {receipt.primary_file?.signed_url ? (
              receipt.primary_file.is_pdf ? (
                <iframe className="document-embed" src={receipt.primary_file.signed_url} title="Receipt PDF preview" />
              ) : receipt.primary_file.is_image ? (
                <img alt={receipt.primary_file.original_name || "Receipt"} className="document-image" src={receipt.primary_file.signed_url} />
              ) : (
                <div className="document-empty">Preview unavailable for this file type.</div>
              )
            ) : (
              <div className="document-empty">No uploaded file is attached to this receipt yet.</div>
            )}
          </div>

          <div className="raw-text-card">
            <div className="eyebrow">Raw extraction text</div>
            <pre>{receipt.raw_text || "No OCR or parsed text was saved for this receipt yet."}</pre>
          </div>
        </article>

        <article className="card review-editor">
          <div className="section-header">
            <div>
              <div className="eyebrow">Editable review</div>
              <div className="section-title">Receipt fields and line items</div>
            </div>
          </div>
          <ReceiptReviewForm receipt={receipt} />
        </article>
      </section>
    </main>
  );
}
