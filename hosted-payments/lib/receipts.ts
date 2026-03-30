import { randomUUID } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type ReceiptStatus = "needs_review" | "approved" | "flagged";

export type ReceiptListFilters = {
  search?: string;
  status?: ReceiptStatus | "all";
};

export type ReceiptItemRecord = {
  id: string;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  total_price: number | null;
};

export type ReceiptFileRecord = {
  id: string;
  bucket_name: string;
  file_type: string | null;
  file_path: string;
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  page_count: number | null;
  signed_url: string | null;
  is_pdf: boolean;
  is_image: boolean;
};

type ReceiptRow = {
  id: string;
  vendor: string | null;
  receipt_date: string | null;
  order_number: string | null;
  total: number | null;
  tax: number | null;
  expense_category: string | null;
  pages_to_keep: string | null;
  confidence: number | null;
  source: string;
  raw_text: string | null;
  structured: Record<string, unknown> | null;
  status: ReceiptStatus;
  created_at: string;
  updated_at: string;
};

export type ReceiptRecord = ReceiptRow & {
  items: ReceiptItemRecord[];
  files: ReceiptFileRecord[];
  primary_file: ReceiptFileRecord | null;
};

type ReceiptUpdateInput = {
  vendor: string;
  receiptDate: string;
  orderNumber: string;
  total: string;
  tax: string;
  expenseCategory: string;
  pagesToKeep: string;
  status: ReceiptStatus;
  items: Array<{
    description: string;
    quantity: string;
    unit_price: string;
    total_price: string;
  }>;
};

function clean(value: string | null | undefined) {
  return String(value || "").trim();
}

function parseNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = clean(value).replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeFileName(name: string | null | undefined) {
  return clean(name)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "receipt";
}

function getPdfServiceUrl() {
  const value = clean(process.env.PDF_SERVICE_URL);
  if (!value) {
    throw new Error("PDF_SERVICE_URL is not configured.");
  }
  return value;
}

async function trimPdfFile(file: ReceiptFileRecord, pagesToKeep: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(file.bucket_name || "receipts").download(file.file_path);
  if (error) throw error;

  const bytes = await data.arrayBuffer();
  const response = await fetch(`${getPdfServiceUrl().replace(/\/$/, "")}/trim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: Buffer.from(bytes).toString("base64"),
      pages: pagesToKeep,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDF trim failed: ${text || response.statusText}`);
  }

  const payload = await response.json();
  const trimmedBase64 = clean(payload?.file);
  if (!trimmedBase64) {
    throw new Error("PDF trim service returned an empty file.");
  }

  const trimmedBuffer = Buffer.from(trimmedBase64, "base64");
  const { error: uploadError } = await supabase.storage.from(file.bucket_name || "receipts").upload(file.file_path, trimmedBuffer, {
    contentType: file.mime_type || "application/pdf",
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { error: fileUpdateError } = await (supabase.from("receipt_files") as any)
    .update({
      page_count: typeof payload?.page_count === "number" ? payload.page_count : null,
      byte_size: typeof payload?.byte_size === "number" ? payload.byte_size : trimmedBuffer.byteLength,
    })
    .eq("id", file.id);

  if (fileUpdateError) throw fileUpdateError;
}

async function withSignedUrls(files: Array<Omit<ReceiptFileRecord, "signed_url" | "is_pdf" | "is_image">>) {
  const supabase = getSupabaseAdmin();
  return Promise.all(
    files.map(async (file) => {
      const mime = file.mime_type || "";
      const isPdf = mime === "application/pdf" || clean(file.original_name).toLowerCase().endsWith(".pdf");
      const isImage = mime.startsWith("image/");
      const { data } = await supabase.storage.from(file.bucket_name || "receipts").createSignedUrl(file.file_path, 60 * 60);

      return {
        ...file,
        signed_url: data?.signedUrl || null,
        is_pdf: isPdf,
        is_image: isImage,
      };
    }),
  );
}

export async function listReceipts(filters: ReceiptListFilters = {}) {
  const supabase = getSupabaseAdmin();
  let query = (supabase.from("receipts") as any)
    .select("id, vendor, receipt_date, order_number, total, tax, expense_category, pages_to_keep, confidence, source, raw_text, structured, status, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (clean(filters.search)) {
    const value = clean(filters.search).replace(/[%(),]/g, " ");
    query = query.or(`vendor.ilike.%${value}%,order_number.ilike.%${value}%,raw_text.ilike.%${value}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as ReceiptRow[];
  if (!rows.length) return [];

  const receiptIds = rows.map((row) => row.id);
  const { data: files, error: fileError } = await (supabase.from("receipt_files") as any)
    .select("id, receipt_id, bucket_name, file_type, file_path, original_name, mime_type, byte_size, page_count")
    .in("receipt_id", receiptIds);

  if (fileError) throw fileError;

  const fileMap = new Map<string, ReceiptFileRecord[]>();

  for (const file of (files || []) as any[]) {
    const signed = await withSignedUrls([
      {
        id: file.id,
        bucket_name: file.bucket_name || "receipts",
        file_type: file.file_type,
        file_path: file.file_path,
        original_name: file.original_name,
        mime_type: file.mime_type,
        byte_size: file.byte_size,
        page_count: file.page_count,
      },
    ]);

    const current = fileMap.get(String(file.receipt_id)) || [];
    current.push(signed[0]);
    fileMap.set(String(file.receipt_id), current);
  }

  return rows.map((row: ReceiptRow) => ({
    ...row,
    files: fileMap.get(row.id) || [],
    primary_file: (fileMap.get(row.id) || [])[0] || null,
  }));
}

export async function getReceiptById(receiptId: string): Promise<ReceiptRecord> {
  const supabase = getSupabaseAdmin();
  const { data: receipt, error } = await (supabase.from("receipts") as any)
    .select("id, vendor, receipt_date, order_number, total, tax, expense_category, pages_to_keep, confidence, source, raw_text, structured, status, created_at, updated_at")
    .eq("id", receiptId)
    .single();

  if (error) throw error;

  const { data: items, error: itemError } = await (supabase.from("receipt_items") as any)
    .select("id, description, quantity, unit_price, total_price")
    .eq("receipt_id", receiptId)
    .order("created_at", { ascending: true });

  if (itemError) throw itemError;

  const { data: files, error: fileError } = await (supabase.from("receipt_files") as any)
    .select("id, bucket_name, file_type, file_path, original_name, mime_type, byte_size, page_count")
    .eq("receipt_id", receiptId)
    .order("created_at", { ascending: true });

  if (fileError) throw fileError;

  const signedFiles = await withSignedUrls(
    (files || []).map((file: any) => ({
      id: file.id,
      bucket_name: file.bucket_name || "receipts",
      file_type: file.file_type,
      file_path: file.file_path,
      original_name: file.original_name,
      mime_type: file.mime_type,
      byte_size: file.byte_size,
      page_count: file.page_count,
    })),
  );

  return {
    ...(receipt as ReceiptRow),
    items: (items || []) as ReceiptItemRecord[],
    files: signedFiles,
    primary_file: signedFiles[0] || null,
  };
}

export async function updateReceipt(receiptId: string, input: ReceiptUpdateInput) {
  const supabase = getSupabaseAdmin();
  const existing = await getReceiptById(receiptId);
  const nextPagesToKeep = clean(input.pagesToKeep);

  if (
    existing.primary_file?.is_pdf &&
    nextPagesToKeep &&
    nextPagesToKeep !== clean(existing.pages_to_keep)
  ) {
    await trimPdfFile(existing.primary_file, nextPagesToKeep);
  }

  const { error: updateError } = await (supabase.from("receipts") as any)
    .update({
      vendor: clean(input.vendor) || null,
      receipt_date: clean(input.receiptDate) || null,
      order_number: clean(input.orderNumber) || null,
      total: parseNumber(input.total),
      tax: parseNumber(input.tax),
      expense_category: clean(input.expenseCategory) || null,
      pages_to_keep: clean(input.pagesToKeep) || null,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", receiptId);

  if (updateError) throw updateError;

  const { error: deleteError } = await (supabase.from("receipt_items") as any).delete().eq("receipt_id", receiptId);
  if (deleteError) throw deleteError;

  const normalizedItems = input.items
    .map((item) => ({
      receipt_id: receiptId,
      description: clean(item.description),
      quantity: parseNumber(item.quantity) ?? 1,
      unit_price: parseNumber(item.unit_price),
      total_price: parseNumber(item.total_price),
      updated_at: new Date().toISOString(),
    }))
    .filter((item) => item.description);

  if (normalizedItems.length) {
    const { error: insertError } = await (supabase.from("receipt_items") as any).insert(normalizedItems);
    if (insertError) throw insertError;
  }

  return getReceiptById(receiptId);
}

async function callReceiptEdgeFunction(file: File, objectPath: string) {
  const url = process.env.SUPABASE_RECEIPT_EDGE_FUNCTION_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;

  const bytes = await file.arrayBuffer();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      source: "upload",
      attachments: [
        {
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          data: Buffer.from(bytes).toString("base64"),
          size: file.size,
          file_path: objectPath,
          bucket_name: "receipts",
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Receipt edge function failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data?.success && data?.id ? String(data.id) : null;
}

export async function uploadReceiptFromForm(formData: FormData) {
  const supabase = getSupabaseAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) {
    throw new Error("A receipt file is required.");
  }

  const objectPath = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFileName(file.name)}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage.from("receipts").upload(objectPath, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) throw uploadError;

  let receiptId: string | null = null;

  try {
    receiptId = await callReceiptEdgeFunction(file, objectPath);
  } catch (error) {
    console.error("Receipt edge function unavailable, using fallback insert", error);
  }

  if (!receiptId) {
    receiptId = randomUUID();
    const { error: receiptError } = await (supabase.from("receipts") as any).insert({
      id: receiptId,
      vendor: null,
      receipt_date: null,
      order_number: null,
      total: null,
      tax: null,
      expense_category: null,
      pages_to_keep: null,
      confidence: 0.2,
      source: "upload",
      raw_text: "",
      structured: { parse_pending: true },
      status: "needs_review",
      updated_at: new Date().toISOString(),
    });

    if (receiptError) throw receiptError;
  }

  const { data: existingFile } = await (supabase.from("receipt_files") as any)
    .select("id")
    .eq("receipt_id", receiptId)
    .eq("file_path", objectPath)
    .maybeSingle();

  if (!existingFile) {
    const { error: fileError } = await (supabase.from("receipt_files") as any).insert({
      receipt_id: receiptId,
      bucket_name: "receipts",
      file_type: file.type === "application/pdf" ? "pdf" : file.type.startsWith("image/") ? "image" : "file",
      file_path: objectPath,
      original_name: file.name,
      mime_type: file.type || "application/octet-stream",
      byte_size: file.size,
    });

    if (fileError) throw fileError;
  }

  return getReceiptById(receiptId);
}

export async function deleteReceipt(receiptId: string) {
  const receipt = await getReceiptById(receiptId);
  const supabase = getSupabaseAdmin();

  const paths = receipt.files.map((file) => file.file_path).filter(Boolean);
  if (paths.length) {
    const { error: removeError } = await supabase.storage.from("receipts").remove(paths);
    if (removeError) throw removeError;
  }

  const { error } = await (supabase.from("receipts") as any).delete().eq("id", receiptId);
  if (error) throw error;

  return { id: receiptId };
}
