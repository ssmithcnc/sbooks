import { randomUUID } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ReceiptUploadInput = {
  file: File;
  vendorName?: string | null;
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

function clean(value: string | null | undefined) {
  return String(value || "").trim();
}

function safeFileName(name: string) {
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

export async function saveReceiptUpload(input: ReceiptUploadInput) {
  const profile = await getDefaultBusinessProfile();
  const supabase = getSupabaseAdmin();

  const fileName = safeFileName(input.file.name);
  const today = new Date().toISOString().slice(0, 10);
  const objectPath = `${profile.slug}/${today}/${randomUUID()}-${fileName}`;
  const bytes = Buffer.from(await input.file.arrayBuffer());

  const { error: storageError } = await supabase.storage
    .from("receipts")
    .upload(objectPath, bytes, {
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });

  if (storageError) {
    throw storageError;
  }

  const metadata = {
    original_filename: input.file.name,
    mime_type: input.file.type || "application/octet-stream",
    byte_size: input.file.size,
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
      object_path: objectPath,
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
