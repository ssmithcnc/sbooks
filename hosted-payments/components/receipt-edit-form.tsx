"use client";

import { useState } from "react";

import { RECEIPT_CATEGORIES } from "@/lib/receipt-categories";

type Props = {
  receipt: {
    id: string;
    vendor_name: string | null;
    receipt_date: string | null;
    total_amount: number | null;
    metadata: {
      category?: string | null;
      notes?: string | null;
      contact_email?: string | null;
    } | null;
  };
};

export function ReceiptEditForm({ receipt }: Props) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/receipts/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: receipt.id,
          vendorName: String(formData.get("vendor_name") || ""),
          category: String(formData.get("category") || ""),
          receiptDate: String(formData.get("receipt_date") || ""),
          totalAmount: String(formData.get("total_amount") || ""),
          contactEmail: String(formData.get("contact_email") || ""),
          notes: String(formData.get("notes") || ""),
        }),
      });

      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Could not save receipt changes.");
      }

      setStatus("done");
      setMessage("Receipt record updated.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Receipt update failed.");
    }
  }

  return (
    <>
      {status === "done" && message ? <div className="notice good">{message}</div> : null}
      {status === "error" && message ? <div className="notice bad">{message}</div> : null}

      <form className="receipt-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Vendor name</span>
          <input defaultValue={receipt.vendor_name || ""} name="vendor_name" type="text" />
        </label>

        <label className="field">
          <span>Category</span>
          <select defaultValue={receipt.metadata?.category || ""} name="category">
            <option value="">Uncategorized</option>
            {RECEIPT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Receipt date</span>
            <input defaultValue={receipt.receipt_date || ""} name="receipt_date" type="date" />
          </label>

          <label className="field">
            <span>Total amount</span>
            <input
              defaultValue={typeof receipt.total_amount === "number" ? String(receipt.total_amount) : ""}
              min="0"
              name="total_amount"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </label>
        </div>

        <label className="field">
          <span>Contact email</span>
          <input defaultValue={receipt.metadata?.contact_email || ""} name="contact_email" type="email" />
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea
            defaultValue={receipt.metadata?.notes || ""}
            name="notes"
            rows={5}
            placeholder="Job name, card used, customer, PPE note, or anything helpful."
          />
        </label>

        <div className="cta-row">
          <button className="btn primary" disabled={status === "saving"} type="submit">
            {status === "saving" ? "Saving..." : "Save receipt record"}
          </button>
        </div>
      </form>
    </>
  );
}
