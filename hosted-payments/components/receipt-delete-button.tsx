"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  receiptId: string;
};

export function ReceiptDeleteButton({ receiptId }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm("Are you sure you want to delete this receipt? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch("/api/receipts/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not delete receipt.");
      }
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not delete receipt.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button className="btn secondary danger" type="button" onClick={handleDelete} disabled={deleting}>
      {deleting ? "Deleting..." : "Delete receipt"}
    </button>
  );
}
