"use client";

import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Props = {
  initialUploaded?: boolean;
  initialReceiptId?: string;
  initialPath?: string;
  initialError?: string;
};

type ReceiptResult = {
  id: string;
  objectPath: string;
};

function getSupabaseBrowser() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export function ReceiptUploadForm({
  initialUploaded,
  initialReceiptId,
  initialPath,
  initialError,
}: Props) {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">(
    initialUploaded ? "done" : initialError ? "error" : "idle"
  );
  const [message, setMessage] = useState(initialError || "");
  const [receiptId, setReceiptId] = useState(initialReceiptId || "");
  const [objectPath, setObjectPath] = useState(initialPath || "");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("uploading");
    setMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("receipt_file");

    if (!(file instanceof File) || !file.size) {
      setStatus("error");
      setMessage("Please choose a receipt image or PDF before uploading.");
      return;
    }

    try {
      const prepareResponse = await fetch("/api/receipts/create-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });

      const prepareJson = await prepareResponse.json();
      if (!prepareResponse.ok || !prepareJson.ok) {
        throw new Error(prepareJson.error || "Could not prepare receipt upload.");
      }

      const { objectPath: preparedPath, token } = prepareJson;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .uploadToSignedUrl(preparedPath, token, file);

      if (uploadError) {
        throw uploadError;
      }

      const finalizeResponse = await fetch("/api/receipts/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectPath: preparedPath,
          originalFileName: file.name,
          mimeType: file.type || "application/octet-stream",
          byteSize: file.size,
          vendorName: String(formData.get("vendor_name") || ""),
          receiptDate: String(formData.get("receipt_date") || ""),
          totalAmount: String(formData.get("total_amount") || ""),
          notes: String(formData.get("notes") || ""),
          contactEmail: String(formData.get("contact_email") || ""),
        }),
      });

      const finalizeJson = await finalizeResponse.json();
      if (!finalizeResponse.ok || !finalizeJson.ok) {
        throw new Error(finalizeJson.error || "Could not save receipt details.");
      }

      const saved = finalizeJson.receipt as ReceiptResult;
      setReceiptId(saved.id);
      setObjectPath(saved.objectPath);
      setStatus("done");
      form.reset();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Receipt upload failed.");
    }
  }

  return (
    <>
      {status === "done" ? (
        <div className="notice good">
          Receipt uploaded successfully.
          <div className="notice-detail">
            Receipt ID: {receiptId} <br />
            Stored at: {objectPath}
          </div>
          <div className="cta-row">
            <a className="btn secondary" href="/receipts">
              Open receipt library
            </a>
          </div>
        </div>
      ) : null}

      {status === "error" && message ? (
        <div className="notice bad">{message}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="receipt-form">
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
          <button className="btn primary" type="submit" disabled={status === "uploading"}>
            {status === "uploading" ? "Uploading..." : "Upload receipt"}
          </button>
        </div>
      </form>
    </>
  );
}
