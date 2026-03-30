"use client";

import { useRef, useState } from "react";

export function ReceiptUploadDropzone() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [receiptId, setReceiptId] = useState("");

  async function submit(file: File) {
    const body = new FormData();
    body.set("file", file);

    setStatus("uploading");
    setMessage("");

    try {
      const response = await fetch("/api/receipts/upload", {
        method: "POST",
        body,
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Could not upload receipt.");
      }

      setReceiptId(String(json.receipt.id));
      setStatus("done");
      setMessage("Receipt uploaded and routed into the review queue.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  return (
    <div className="upload-stack">
      {status === "done" && message ? (
        <div className="notice good">
          {message}
          <div className="notice-detail">
            <a href={`/receipts/${receiptId}`}>Open review screen</a>
          </div>
        </div>
      ) : null}
      {status === "error" && message ? <div className="notice bad">{message}</div> : null}

      <button
        className={`dropzone ${isDragging ? "dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) {
            void submit(file);
          }
        }}
        type="button"
      >
        <input
          accept="image/*,application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void submit(file);
            }
          }}
          ref={inputRef}
          type="file"
        />
        <span className="dropzone-kicker">Drag and drop upload</span>
        <strong>Drop a PDF or receipt image here</strong>
        <span>Backend upload, parsing handoff, then straight into review.</span>
        <span className="dropzone-meta">{status === "uploading" ? "Uploading..." : "Supports PDFs and photos"}</span>
      </button>
    </div>
  );
}
