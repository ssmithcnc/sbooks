export type ReceiptItemInput = {
  description: string;
  qty: number | null;
  unit_price: number | null;
  total: number | null;
};

export type ParsedReceipt = {
  vendor: string | null;
  date: string | null;
  total: number | null;
  tax: number | null;
  order_number: string | null;
  items: ReceiptItemInput[];
  confidence: number;
  source_parser: string;
};

export function detectVendor(text: string) {
  const t = text.toLowerCase();
  if (t.includes("lowe's") || t.includes("lowes")) return "lowes";
  if (t.includes("home depot") || t.includes("homedepot")) return "homedepot";
  return "unknown";
}

export function cleanText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseMoney(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseQty(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clampConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

export function normalizeItems(items: ReceiptItemInput[] | null | undefined) {
  return (items || [])
    .map((item) => ({
      description: String(item.description || "").trim(),
      qty: typeof item.qty === "number" && Number.isFinite(item.qty) ? item.qty : 1,
      unit_price: typeof item.unit_price === "number" && Number.isFinite(item.unit_price) ? item.unit_price : null,
      total: typeof item.total === "number" && Number.isFinite(item.total) ? item.total : null,
    }))
    .filter((item) => item.description);
}

export function inferDate(text: string) {
  const match =
    text.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/) ||
    text.match(/\b([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\b/);
  return match?.[1] ?? null;
}

export function coerceParsedReceipt(input: Partial<ParsedReceipt>, parser: string): ParsedReceipt {
  return {
    vendor: input.vendor ? String(input.vendor).trim() : null,
    date: input.date ? String(input.date).trim() : null,
    total: typeof input.total === "number" && Number.isFinite(input.total) ? input.total : null,
    tax: typeof input.tax === "number" && Number.isFinite(input.tax) ? input.tax : null,
    order_number: input.order_number ? String(input.order_number).trim() : null,
    items: normalizeItems(input.items),
    confidence: clampConfidence(input.confidence ?? 0),
    source_parser: parser,
  };
}

export function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in LLM response.");
  }
  return candidate.slice(start, end + 1);
}

export function safeJsonParse(text: string) {
  const candidate = extractJsonObject(text)
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'");

  return JSON.parse(candidate);
}

export function countPdfPages(text: string) {
  const matches = text.match(/(?:^|\n)\s*page\s+\d+\s+(?:of|\/)\s+\d+/gi);
  return matches?.length ?? null;
}
