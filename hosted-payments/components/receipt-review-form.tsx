"use client";

import { useState } from "react";

import type { ReceiptRecord } from "@/lib/receipts";

type Props = {
  receipt: ReceiptRecord;
};

type DraftItem = {
  description: string;
  quantity: string;
  unit_price: string;
  total_price: string;
};

function toInput(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function ReceiptReviewForm({ receipt }: Props) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [vendor, setVendor] = useState(receipt.vendor || "");
  const [receiptDate, setReceiptDate] = useState(receipt.receipt_date?.slice(0, 10) || "");
  const [orderNumber, setOrderNumber] = useState(receipt.order_number || "");
  const [total, setTotal] = useState(toInput(receipt.total));
  const [tax, setTax] = useState(toInput(receipt.tax));
  const [reviewStatus, setReviewStatus] = useState<ReceiptRecord["status"]>(receipt.status);
  const [items, setItems] = useState<DraftItem[]>(
    receipt.items.length
      ? receipt.items.map((item) => ({
          description: item.description,
          quantity: toInput(item.quantity),
          unit_price: toInput(item.unit_price),
          total_price: toInput(item.total_price),
        }))
      : [{ description: "", quantity: "1", unit_price: "", total_price: "" }],
  );

  function updateItem(index: number, field: keyof DraftItem, value: string) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  async function save(nextStatus?: ReceiptRecord["status"]) {
    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch("/api/receipts/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: receipt.id,
          vendor,
          receiptDate,
          orderNumber,
          total,
          tax,
          status: nextStatus || reviewStatus,
          items,
        }),
      });

      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Could not save receipt.");
      }

      if (nextStatus) {
        setReviewStatus(nextStatus);
      }
      setStatus("done");
      setMessage(nextStatus === "approved" ? "Receipt approved." : nextStatus === "flagged" ? "Receipt flagged." : "Receipt saved.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not save receipt.");
    }
  }

  return (
    <div className="review-panel">
      {status === "done" && message ? <div className="notice good">{message}</div> : null}
      {status === "error" && message ? <div className="notice bad">{message}</div> : null}

      <div className="review-grid">
        <label className="field">
          <span>Vendor</span>
          <input value={vendor} onChange={(event) => setVendor(event.target.value)} />
        </label>

        <label className="field">
          <span>Status</span>
          <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ReceiptRecord["status"])}>
            <option value="needs_review">Needs review</option>
            <option value="approved">Approved</option>
            <option value="flagged">Flagged</option>
          </select>
        </label>

        <label className="field">
          <span>Receipt date</span>
          <input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} />
        </label>

        <label className="field">
          <span>Order number</span>
          <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} />
        </label>

        <label className="field">
          <span>Total</span>
          <input step="0.01" type="number" value={total} onChange={(event) => setTotal(event.target.value)} />
        </label>

        <label className="field">
          <span>Tax</span>
          <input step="0.01" type="number" value={tax} onChange={(event) => setTax(event.target.value)} />
        </label>
      </div>

      <div className="line-items">
        <div className="section-header">
          <div>
            <div className="eyebrow">Line items</div>
            <div className="section-title">Editable extracted items</div>
          </div>
          <button
            className="btn secondary"
            onClick={() => setItems((current) => [...current, { description: "", quantity: "1", unit_price: "", total_price: "" }])}
            type="button"
          >
            Add item
          </button>
        </div>

        <div className="line-item-list">
          {items.map((item, index) => (
            <div className="line-item-card" key={`${index}-${item.description}`}>
              <label className="field line-item-description">
                <span>Description</span>
                <input value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} />
              </label>
              <label className="field">
                <span>Qty</span>
                <input step="0.01" type="number" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} />
              </label>
              <label className="field">
                <span>Unit</span>
                <input step="0.01" type="number" value={item.unit_price} onChange={(event) => updateItem(index, "unit_price", event.target.value)} />
              </label>
              <label className="field">
                <span>Total</span>
                <input step="0.01" type="number" value={item.total_price} onChange={(event) => updateItem(index, "total_price", event.target.value)} />
              </label>
              <button className="btn secondary danger" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="cta-row sticky-actions">
        <button className="btn secondary" disabled={status === "saving"} onClick={() => save("flagged")} type="button">Flag</button>
        <button className="btn secondary" disabled={status === "saving"} onClick={() => save()} type="button">
          {status === "saving" ? "Saving..." : "Edit / Save"}
        </button>
        <button className="btn primary" disabled={status === "saving"} onClick={() => save("approved")} type="button">Approve</button>
      </div>
    </div>
  );
}
