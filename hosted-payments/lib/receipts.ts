import { randomUUID } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ReceiptUploadInput = {
  objectPath: string;
  originalFileName?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  vendorName?: string | null;
  category?: string | null;
  receiptDate?: string | null;
  totalAmount?: string | null;
  notes?: string | null;
  contactEmail?: string | null;
};

type BusinessProfileRow = {
  id: string;
  slug: string;
  company_name: string;
};

type ReceiptUploadRow = {
  id: string;
  business_profile_id?: string;
  object_path: string;
  vendor_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  status: string;
  created_at: string;
  metadata: {
    mime_type?: string | null;
    original_filename?: string | null;
    byte_size?: number | null;
    category?: string | null;
    notes?: string | null;
    contact_email?: string | null;
  } | null;
};

export type ReceiptSortKey = "uploaded" | "vendor" | "receipt_date" | "total" | "category" | "status";

export type ReceiptRecord = Awaited<ReturnType<typeof listReceiptUploads>>[number];

function clean(value: string | null | undefined) {
  return String(value || "").trim();
}

function safeFileName(name: string | null | undefined) {
  return clean(name)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "receipt-upload";
}

async function getDefaultBusinessProfile() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("business_profiles")
    .select("id, slug, company_name")
    .limit(1)
    .returns<BusinessProfileRow[]>();

  if (error) {
    throw error;
  }

  const [profile] = data || [];
  if (!profile) {
    throw new Error("No hosted business profile found yet. Publish an invoice payment link first.");
  }
  return profile;
}

export async function listReceiptUploads(limit = 50, sort: ReceiptSortKey = "uploaded", direction: "asc" | "desc" = "desc") {
  const profile = await getDefaultBusinessProfile();
  const supabase = getSupabaseAdmin();

  const sortColumn =
    sort === "vendor"
      ? "vendor_name"
      : sort === "receipt_date"
        ? "receipt_date"
        : sort === "total"
          ? "total_amount"
          : sort === "status"
            ? "status"
            : "created_at";

  const { data, error } = await (supabase.from("receipt_uploads") as any)
    .select("id, object_path, vendor_name, receipt_date, total_amount, status, created_at, metadata")
    .eq("business_profile_id", profile.id)
    .order(sortColumn, { ascending: direction === "asc", nullsFirst: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const rows = ((data || []) as ReceiptUploadRow[]).map(async (row) => {
    const mimeType = row.metadata?.mime_type || "";
    const originalName = row.metadata?.original_filename || row.object_path.split("/").pop() || "receipt";
    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf" || originalName.toLowerCase().endsWith(".pdf");

    const { data: signed } = await supabase.storage
      .from("receipts")
      .createSignedUrl(row.object_path, 60 * 60);

    return {
      ...row,
      original_name: originalName,
      mime_type: mimeType,
      is_image: isImage,
      is_pdf: isPdf,
      signed_url: signed?.signedUrl || null,
    };
  });

  const resolved = await Promise.all(rows);

  if (sort === "category") {
    const sorted = [...resolved].sort((a, b) => {
      const left = (a.metadata?.category || "").toLowerCase();
      const right = (b.metadata?.category || "").toLowerCase();
      return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
    });
    return sorted;
  }

  return resolved;
}

export async function getReceiptUploadById(receiptId: string) {
  const profile = await getDefaultBusinessProfile();
  const supabase = getSupabaseAdmin();

  const { data, error } = await (supabase.from("receipt_uploads") as any)
    .select("id, object_path, vendor_name, receipt_date, total_amount, status, created_at, metadata")
    .eq("business_profile_id", profile.id)
    .eq("id", receiptId)
    .single();

  if (error) {
    throw error;
  }

  const row = data as ReceiptUploadRow | null;
  if (!row) {
    throw new Error("Receipt not found.");
  }

  const originalName = row.metadata?.original_filename || row.object_path.split("/").pop() || "receipt";
  const mimeType = row.metadata?.mime_type || "";
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf" || originalName.toLowerCase().endsWith(".pdf");
  const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(row.object_path, 60 * 60);

  return {
    ...row,
    original_name: originalName,
    mime_type: mimeType,
    is_image: isImage,
    is_pdf: isPdf,
    signed_url: signed?.signedUrl || null,
  };
}

export async function deleteReceiptUpload(receiptId: string) {
  const profile = await getDefaultBusinessProfile();
  const supabase = getSupabaseAdmin();

  const { data, error } = await (supabase.from("receipt_uploads") as any)
    .select("id, object_path")
    .eq("business_profile_id", profile.id)
    .eq("id", receiptId)
    .single();

  if (error) {
    throw error;
  }

  const receipt = data as { id: string; object_path: string } | null;
  if (!receipt) {
    throw new Error("Receipt not found.");
  }

  const { error: storageError } = await supabase.storage.from("receipts").remove([receipt.object_path]);
  if (storageError) {
    throw storageError;
  }

  const { error: deleteError } = await (supabase.from("receipt_uploads") as any)
    .delete()
    .eq("id", receipt.id)
    .eq("business_profile_id", profile.id);

  if (deleteError) {
    throw deleteError;
  }

  return {
    id: receipt.id,
    objectPath: receipt.object_path,
  };
}

export async function createReceiptUploadTarget(input: {
  fileName?: string | null;
  contentType?: string | null;
}) {
  const profile = await getDefaultBusinessProfile();
  const supabase = getSupabaseAdmin();

  const fileName = safeFileName(input.fileName);
  const today = new Date().toISOString().slice(0, 10);
  const objectPath = `${profile.slug}/${today}/${randomUUID()}-${fileName}`;

  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUploadUrl(objectPath);

  if (error) {
    throw error;
  }

  return {
    objectPath,
    token: data.token,
    businessName: profile.company_name,
  };
}

export async function finalizeReceiptUpload(input: ReceiptUploadInput) {
  const profile = await getDefaultBusinessProfile();
  const supabase = getSupabaseAdmin();

  const metadata = {
    original_filename: clean(input.originalFileName) || null,
    mime_type: clean(input.mimeType) || "application/octet-stream",
    byte_size: typeof input.byteSize === "number" ? input.byteSize : null,
    category: clean(input.category) || null,
    notes: clean(input.notes) || null,
    contact_email: clean(input.contactEmail) || null,
  };

  const totalText = clean(input.totalAmount);
  const parsedTotal = totalText ? Number(totalText) : null;

  const { data, error } = await (supabase.from("receipt_uploads") as any)
    .insert({
      business_profile_id: profile.id,
      source: "mobile-web",
      bucket_name: "receipts",
      object_path: input.objectPath,
      vendor_name: clean(input.vendorName) || null,
      receipt_date: clean(input.receiptDate) || null,
      total_amount: Number.isFinite(parsedTotal) ? parsedTotal : null,
      status: "uploaded",
      metadata,
      updated_at: new Date().toISOString(),
    })
    .select("id, object_path")
    .single();

  if (error) {
    throw error;
  }

  return {
    id: data.id as string,
    objectPath: data.object_path as string,
    businessName: profile.company_name,
  };
}

export async function updateReceiptUpload(
  receiptId: string,
  input: Omit<ReceiptUploadInput, "objectPath" | "originalFileName" | "mimeType" | "byteSize">
) {
  const profile = await getDefaultBusinessProfile();
  const supabase = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await (supabase.from("receipt_uploads") as any)
    .select("id, metadata")
    .eq("business_profile_id", profile.id)
    .eq("id", receiptId)
    .single();

  if (fetchError) {
    throw fetchError;
  }

  const existingRow = existing as { id: string; metadata?: ReceiptUploadRow["metadata"] } | null;
  if (!existingRow) {
    throw new Error("Receipt not found.");
  }

  const mergedMetadata = {
    ...(existingRow.metadata || {}),
    category: clean(input.category) || null,
    notes: clean(input.notes) || null,
    contact_email: clean(input.contactEmail) || null,
  };

  const totalText = clean(input.totalAmount);
  const parsedTotal = totalText ? Number(totalText) : null;

  const { data, error } = await (supabase.from("receipt_uploads") as any)
    .update({
      vendor_name: clean(input.vendorName) || null,
      receipt_date: clean(input.receiptDate) || null,
      total_amount: Number.isFinite(parsedTotal) ? parsedTotal : null,
      metadata: mergedMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("business_profile_id", profile.id)
    .eq("id", receiptId)
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data as { id: string };
}
