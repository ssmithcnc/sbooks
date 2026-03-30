import Link from "next/link";

import { listReceiptUploads, type ReceiptSortKey } from "@/lib/receipts";
import { ReceiptDeleteButton } from "@/components/receipt-delete-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SORT_OPTIONS: Array<{ key: ReceiptSortKey; label: string }> = [
  { key: "uploaded", label: "Uploaded" },
  { key: "vendor", label: "Vendor" },
  { key: "receipt_date", label: "Receipt date" },
  { key: "total", label: "Total" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
];

type SearchParamsShape =
  | Promise<Record<string, string | string[] | undefined>>
  | Record<string, string | string[] | undefined>
  | undefined;

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

function getSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isSortKey(value: string | undefined): value is ReceiptSortKey {
  return SORT_OPTIONS.some((option) => option.key === value);
}

function buildSortHref(sort: ReceiptSortKey, currentSort: ReceiptSortKey, currentDirection: "asc" | "desc") {
  const nextDirection = currentSort === sort && currentDirection === "asc" ? "desc" : "asc";
  return `/receipts?sort=${sort}&direction=${nextDirection}`;
}

export default async function ReceiptsIndexPage({
  searchParams,
}: {
  searchParams?: SearchParamsShape;
}) {
  const resolvedSearch = await Promise.resolve(searchParams ?? {});
  const sortCandidate = getSingle(resolvedSearch.sort);
  const directionCandidate = getSingle(resolvedSearch.direction);
  const sort = isSortKey(sortCandidate) ? sortCandidate : "uploaded";
  const direction = directionCandidate === "asc" ? "asc" : "desc";
  const receipts = await listReceiptUploads(200, sort, direction);

  return (
    <main className="shell shell-wide">
      <section className="hero">
        <div className="brand-mark" aria-hidden="true">
          <div className="brand-mark-text">
            <strong>S</strong>
            <span>books</span>
          </div>
        </div>
        <div>
          <div className="hero-title">Receipt Admin</div>
          <div className="hero-subtitle">
            Sort, review, edit, open, and safely delete uploaded receipt records.
          </div>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <div className="receipt-toolbar">
            <div>
              <div className="eyebrow">Cloud bucket</div>
              <div className="receipt-title">Sortable receipt records</div>
            </div>
            <div className="cta-row">
              <Link className="btn secondary" href="/receipts/upload">
                Upload another receipt
              </Link>
            </div>
          </div>

          {receipts.length ? (
            <div className="receipt-admin">
              <div className="receipt-sortbar">
                <div className="eyebrow">
                  Showing {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
                </div>
                <div className="receipt-sort-links">
                  {SORT_OPTIONS.map((option) => (
                    <Link
                      key={option.key}
                      className={`sort-chip ${sort === option.key ? "active" : ""}`}
                      href={buildSortHref(option.key, sort, direction)}
                    >
                      {option.label}
                      {sort === option.key ? (direction === "asc" ? " ↑" : " ↓") : ""}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="receipt-table-wrap">
                <table className="receipt-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Vendor</th>
                      <th>Receipt date</th>
                      <th>Total</th>
                      <th>Category</th>
                      <th>Notes</th>
                      <th>Status</th>
                      <th>Uploaded</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((receipt) => (
                      <tr key={receipt.id}>
                        <td>
                          <div className="receipt-file-cell">
                            <div className="receipt-mini-preview">
                              {receipt.signed_url && receipt.is_image ? (
                                <img className="receipt-thumb" src={receipt.signed_url} alt={receipt.original_name} />
                              ) : (
                                <div className="receipt-file-pill">{receipt.is_pdf ? "PDF" : "FILE"}</div>
                              )}
                            </div>
                            <div>
                              <div className="receipt-file-name">{receipt.original_name}</div>
                              <div className="receipt-path">{receipt.object_path}</div>
                            </div>
                          </div>
                        </td>
                        <td>{receipt.vendor_name || "Unlabeled receipt"}</td>
                        <td>{receipt.receipt_date || "Unknown"}</td>
                        <td>{formatCurrency(receipt.total_amount)}</td>
                        <td>{receipt.metadata?.category || "Uncategorized"}</td>
                        <td className="receipt-notes-cell">{receipt.metadata?.notes || "—"}</td>
                        <td>
                          <span className="pill">{receipt.status}</span>
                        </td>
                        <td>{formatDate(receipt.created_at)}</td>
                        <td>
                          <div className="receipt-actions">
                            <Link className="btn secondary" href={`/receipts/${receipt.id}`}>
                              Edit
                            </Link>
                            {receipt.signed_url ? (
                              <a className="btn primary" href={receipt.signed_url} target="_blank" rel="noopener">
                                Open
                              </a>
                            ) : null}
                            <ReceiptDeleteButton receiptId={receipt.id} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
