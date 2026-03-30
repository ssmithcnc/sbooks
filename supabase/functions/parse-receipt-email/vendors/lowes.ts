import { coerceParsedReceipt, inferDate, parseMoney, parseQty, type ParsedReceipt, type ReceiptItemInput } from "../utils.ts";

const STOP_WORDS = [
  "subtotal",
  "tax",
  "sales tax",
  "total",
  "payment",
  "visa",
  "mastercard",
  "change due",
  "mylowes",
  "return policy",
];

function shouldSkipLine(line: string) {
  const lower = line.toLowerCase().trim();
  if (!lower) return true;
  return STOP_WORDS.some((word) => lower.includes(word));
}

function parseLineItem(line: string): ReceiptItemInput | null {
  const compact = line.replace(/\s+/g, " ").trim();
  const match =
    compact.match(/^(.*?)\s+qty[: ]?(\d+(?:\.\d+)?)\s+@?\$?(\d+\.\d{2})\s+\$?(\d+\.\d{2})$/i) ||
    compact.match(/^(\d+(?:\.\d+)?)\s+(.*?)\s+\$?(\d+\.\d{2})\s+\$?(\d+\.\d{2})$/i) ||
    compact.match(/^(.*?)\s+\$?(\d+\.\d{2})\s+\$?(\d+\.\d{2})$/i);

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

  return {
    description: match[1].trim(),
    qty: 1,
    unit_price: parseMoney(match[2]),
    total: parseMoney(match[3]),
  };
}

export function parseLowes(text: string): ParsedReceipt {
  const order =
    text.match(/(?:order|invoice|transaction)\s*(?:#|number)?[:\s]*([A-Z0-9-]+)/i)?.[1] ??
    text.match(/mylowes\s+receipt\s+([A-Z0-9-]+)/i)?.[1] ??
    null;
  const total =
    parseMoney(text.match(/(?:total due|amount due|total)[:\s$]*([0-9,]+\.\d{2})/i)?.[1]) ??
    parseMoney(text.match(/\bgrand total[:\s$]*([0-9,]+\.\d{2})/i)?.[1]);
  const tax = parseMoney(text.match(/(?:tax|sales tax)[:\s$]*([0-9,]+\.\d{2})/i)?.[1]);
  const date =
    text.match(/(?:date|order date|purchase date)[:\s]*([0-9\/-]{6,10})/i)?.[1] ??
    inferDate(text);

  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !shouldSkipLine(line))
    .map((line) => parseLineItem(line))
    .filter((item): item is ReceiptItemInput => Boolean(item));

  const confidence = items.length ? 0.94 : 0.84;

  return coerceParsedReceipt(
    {
      vendor: "Lowe's",
      date,
      order_number: order,
      total,
      tax,
      items,
      confidence,
    },
    "lowes",
  );
}
