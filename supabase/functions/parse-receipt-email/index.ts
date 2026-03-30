import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

import { extractReceipt } from "./parser.ts";
import { extractPdfText } from "./pdf.ts";
import { cleanText, countPdfPages } from "./utils.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    const body = await req.json();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const rawText = String(body["body-plain"] || body.raw_text || "");
    const htmlText = String(body["body-html"] || body.html || "");

    let combinedText = cleanText([rawText, htmlText].filter(Boolean).join("\n\n"));
    const fileRows: Array<Record<string, unknown>> = [];

    for (const attachment of attachments) {
      const mimeType = String(attachment.content_type || attachment.mimeType || "");
      const base64Data = String(attachment.data || attachment.base64 || "");
      const filePath = String(attachment.file_path || attachment.filePath || "");
      const originalName = String(attachment.filename || attachment.name || "");

      if (!base64Data && !filePath) {
        console.warn("Skipping attachment without file content or path", { originalName, mimeType });
        continue;
      }

      let extractedText = "";
      let pageCount: number | null = null;

      if (mimeType === "application/pdf" && base64Data) {
        const pdf = await extractPdfText(base64Data);
        extractedText = cleanText(pdf.text);
        pageCount = pdf.page_count ?? countPdfPages(extractedText);
      }

      if (extractedText) {
        combinedText = cleanText(`${combinedText}\n\n${extractedText}`);
      }

      fileRows.push({
        bucket_name: String(attachment.bucket_name || "receipts"),
        file_type: mimeType.includes("pdf") ? "pdf" : mimeType.startsWith("image/") ? "image" : "file",
        file_path: filePath || null,
        original_name: originalName || null,
        mime_type: mimeType || null,
        byte_size: typeof attachment.size === "number" ? attachment.size : null,
        page_count: pageCount,
      });
    }

    const parsed = await extractReceipt(combinedText);
    const status = parsed.confidence >= 0.93 ? "approved" : parsed.confidence >= 0.6 ? "needs_review" : "flagged";

    const { data: receipt, error: receiptError } = await supabase
      .from("receipts")
      .insert({
        vendor: parsed.vendor,
        receipt_date: parsed.date,
        total: parsed.total,
        tax: parsed.tax,
        order_number: parsed.order_number,
        raw_text: combinedText,
        structured: {
          ...parsed,
          attachments: fileRows,
          email_subject: body.subject ?? null,
          email_from: body.from ?? null,
        },
        source: body.source || "email",
        confidence: parsed.confidence,
        status,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (receiptError) {
      console.error("Failed to insert receipt", receiptError);
      throw receiptError;
    }

    if (parsed.items.length) {
      const { error: itemError } = await supabase.from("receipt_items").insert(
        parsed.items.map((item) => ({
          receipt_id: receipt.id,
          description: item.description,
          quantity: item.qty ?? 1,
          unit_price: item.unit_price,
          total_price: item.total,
          updated_at: new Date().toISOString(),
        })),
      );

      if (itemError) {
        console.error("Failed to insert receipt items", itemError);
        throw itemError;
      }
    }

    if (fileRows.length) {
      const { error: fileError } = await supabase.from("receipt_files").insert(
        fileRows
          .filter((row) => row.file_path)
          .map((row) => ({
            ...row,
            receipt_id: receipt.id,
          })),
      );

      if (fileError) {
        console.error("Failed to insert receipt files", fileError);
        throw fileError;
      }
    }

    console.log("Receipt processed", {
      receipt_id: receipt.id,
      vendor: parsed.vendor,
      status,
      file_count: fileRows.length,
      item_count: parsed.items.length,
    });

    return json({ success: true, id: receipt.id, status, confidence: parsed.confidence });
  } catch (error) {
    console.error("parse-receipt-email failed", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
