import { coerceParsedReceipt, inferDate, parseMoney, parseQty, type ParsedReceipt, type ReceiptItemInput } from "../utils.ts";

const STOP_WORDS = [
  "subtotal",
  "tax",
  "sales tax",
  "total",
  "change",
  "cash",
  "customer copy",
  "authorization",
  "home depot consumer credit",
];

function shouldSkipLine(line: string) {
  const lower = line.toLowerCase().trim();
  if (!lower) return true;
  return STOP_WORDS.some((word) => lower.includes(word));
}

function parseLineItem(line: string): ReceiptItemInput | null {
  const compact = line.replace(/\s+/g, " ").trim();
  const match =
    compact.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+x\s+\$?(\d+\.\d{2})\s+\$?(\d+\.\d{2})$/i) ||
    compact.match(/^(\d+(?:\.\d+)?)\s+(.+?)\s+\$?(\d+\.\d{2})\s+\$?(\d+\.\d{2})$/i) ||
    compact.match(/^(.+?)\s+\$?(\d+\.\d{2})$/i);

  if (!match) return null;

  if (match.length === 5 && compact.match(/^\d/)) {
    return {
      description: match[2].trim(),
      qty: parseQty(match[1]),
      unit_price: parseMoney(match[3]),
      total: parseMoney(match[4]),
    };
  }

  if (match.length === 5) {
    return {
      description: match[1].trim(),
      qty: parseQty(match[2]),
      unit_price: parseMoney(match[3]),
      total: parseMoney(match[4]),
    };
  }

  const unitPrice = parseMoney(match[2]);
  return {
    description: match[1].trim(),
    qty: 1,
    unit_price: unitPrice,
    total: unitPrice,
  };
}

export function parseHomeDepot(text: string): ParsedReceipt {
  const order =
    text.match(/(?:order|transaction|invoice)\s*(?:#|number)?[:\s]*([A-Z0-9-]+)/i)?.[1] ??
    text.match(/(?:store|register)\s+\d+\s+trans\s+([A-Z0-9-]+)/i)?.[1] ??
    null;
  const total =
    parseMoney(text.match(/(?:total|grand total|amount due)[:\s$]*([0-9,]+\.\d{2})/i)?.[1]) ??
    null;
  const tax = parseMoney(text.match(/(?:tax|sales tax)[:\s$]*([0-9,]+\.\d{2})/i)?.[1]);
  const date =
    text.match(/(?:date|purchase date)[:\s]*([0-9\/-]{6,10})/i)?.[1] ??
    inferDate(text);

  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !shouldSkipLine(line))
    .map((line) => parseLineItem(line))
    .filter((item): item is ReceiptItemInput => Boolean(item));

  const confidence = items.length ? 0.9 : 0.76;

  return coerceParsedReceipt(
    {
      vendor: "Home Depot",
      date,
      order_number: order,
      total,
      tax,
      items,
      confidence,
    },
    "homedepot",
  );
}
