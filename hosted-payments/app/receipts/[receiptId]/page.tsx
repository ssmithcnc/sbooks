import Link from "next/link";
import { notFound } from "next/navigation";

import { ReceiptDeleteButton } from "@/components/receipt-delete-button";
import { ReceiptEditForm } from "@/components/receipt-edit-form";
import { getReceiptUploadById } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReceiptEditPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const { receiptId } = await params;

  let receipt;
  try {
    receipt = await getReceiptUploadById(receiptId);
  } catch {
    notFound();
  }

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
          <div className="hero-title">Edit receipt record</div>
          <div className="hero-subtitle">
            Fix vendor, category, date, amount, notes, and contact details from one admin form.
          </div>
        </div>
      </section>

      <section className="grid two receipt-grid">
        <article className="card muted">
          <div className="eyebrow">Preview</div>
          <div className="receipt-title">{receipt.vendor_name || "Unlabeled receipt"}</div>
          <div className="details">
            <div>Uploaded: {receipt.created_at}</div>
            <div>Status: {receipt.status}</div>
            <div>File: {receipt.original_name}</div>
            <div>Path: {receipt.object_path}</div>
          </div>
          <div className="receipt-edit-preview">
            {receipt.signed_url && receipt.is_image ? (
              <img className="receipt-edit-image" src={receipt.signed_url} alt={receipt.original_name} />
            ) : (
              <div className="receipt-edit-file">
                <div className="receipt-file-pill">{receipt.is_pdf ? "PDF" : "FILE"}</div>
                <div className="details">
                  {receipt.is_pdf
                    ? "PDF previews open in a new tab so you can verify the scanned document."
                    : "This file type can still be opened even if there is no inline preview."}
                </div>
              </div>
            )}
          </div>
          <div className="cta-row">
            <Link className="btn secondary" href="/receipts">
              Back to receipt admin
            </Link>
            {receipt.signed_url ? (
              <a className="btn primary" href={receipt.signed_url} target="_blank" rel="noopener">
                Open file
              </a>
            ) : null}
            <ReceiptDeleteButton receiptId={receipt.id} />
          </div>
        </article>

        <article className="card">
          <div className="eyebrow">Record details</div>
          <div className="receipt-title">Edit metadata</div>
          <ReceiptEditForm receipt={receipt} />
        </article>
      </section>
    </main>
  );
}
