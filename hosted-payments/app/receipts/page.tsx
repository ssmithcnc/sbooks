import Link from "next/link";

import { ReceiptUploadDropzone } from "@/components/receipt-upload-dropzone";
import { listReceipts, type ReceiptStatus } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParamsShape = Promise<Record<string, string | string[] | undefined>> | undefined;

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
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isStatus(value: string | undefined): value is ReceiptStatus | "all" {
  return value === "all" || value === "needs_review" || value === "approved" || value === "flagged";
}

export default async function ReceiptsIndexPage({
  searchParams,
}: {
  searchParams?: SearchParamsShape;
}) {
  const resolvedSearch = (await searchParams) ?? {};
  const statusCandidate = getSingle(resolvedSearch.status);
  const search = getSingle(resolvedSearch.search) || "";
  const status = isStatus(statusCandidate) ? statusCandidate : "all";
  const receipts = await listReceipts({ status, search });

  return (
    <main className="shell shell-wide">
      <section className="hero">
        <div>
          <div className="eyebrow">Inbox</div>
          <div className="hero-title">Receipt review queue</div>
          <div className="hero-subtitle">Search, filter, and approve receipts with as few clicks as possible.</div>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <div className="receipt-toolbar">
            <div>
              <div className="eyebrow">Workflow</div>
              <div className="receipt-title">Needs review inbox</div>
            </div>
            <div className="cta-row">
              <Link className="btn secondary" href="/receipts/upload">Open upload page</Link>
            </div>
          </div>

          <div className="dashboard-grid">
            <div className="card inset">
              <div className="eyebrow">Quick upload</div>
              <div className="section-title">Drop a receipt</div>
              <ReceiptUploadDropzone />
            </div>

            <div className="card inset">
              <div className="eyebrow">Filters</div>
              <form className="filters-row" method="get">
                <label className="field">
                  <span>Search</span>
                  <input defaultValue={search} name="search" placeholder="Vendor, order number, raw text..." />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select defaultValue={status} name="status">
                    <option value="all">All</option>
                    <option value="needs_review">Needs review</option>
                    <option value="approved">Approved</option>
                    <option value="flagged">Flagged</option>
                  </select>
                </label>
                <div className="cta-row filters-actions">
                  <button className="btn primary" type="submit">Apply</button>
                  <Link className="btn secondary" href="/receipts">Reset</Link>
                </div>
              </form>
            </div>
          </div>

          {receipts.length ? (
            <div className="receipt-admin">
              <div className="receipt-sortbar">
                <div className="eyebrow">
                  Showing {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
                </div>
                <div className="receipt-sort-links">
                  <span className="sort-chip active">Newest first</span>
                </div>
              </div>

              <div className="receipt-table-wrap">
                <table className="receipt-table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Category</th>
                      <th>Date</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Confidence</th>
                      <th>Source</th>
                      <th>Uploaded</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((receipt: Awaited<ReturnType<typeof listReceipts>>[number]) => (
                      <tr key={receipt.id}>
                        <td>{receipt.vendor || "Unknown vendor"}</td>
                        <td>{receipt.expense_category || "Not set"}</td>
                        <td>{receipt.receipt_date ? formatDate(receipt.receipt_date) : "Unknown"}</td>
                        <td>{formatCurrency(receipt.total)}</td>
                        <td>
                          <span className={`pill status-${receipt.status}`}>{receipt.status.replace("_", " ")}</span>
                        </td>
                        <td>{Math.round((receipt.confidence || 0) * 100)}%</td>
                        <td>{receipt.source}</td>
                        <td>{formatDate(receipt.created_at)}</td>
                        <td>
                          <div className="receipt-actions">
                            <Link className="btn primary" href={`/receipts/${receipt.id}`}>Review</Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="notice bad">No receipts matched this filter yet.</div>
          )}
        </article>
      </section>
    </main>
  );
}
