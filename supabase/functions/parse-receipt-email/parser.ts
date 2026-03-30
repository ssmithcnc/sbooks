import { parseHomeDepot } from "./vendors/homedepot.ts";
import { parseLowes } from "./vendors/lowes.ts";
import {
  clampConfidence,
  coerceParsedReceipt,
  detectVendor,
  safeJsonParse,
  type ParsedReceipt,
} from "./utils.ts";

function scoreTotals(parsed: ParsedReceipt) {
  if (!parsed.items.length || typeof parsed.total !== "number") {
    return parsed;
  }

  const itemSum = parsed.items.reduce((sum, item) => sum + (item.total ?? 0), 0);
  const delta = Math.abs(itemSum - parsed.total);

  if (delta > 1) {
    parsed.confidence = clampConfidence(parsed.confidence - 0.18);
  }

  return parsed;
}

async function llmParse(text: string): Promise<ParsedReceipt> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_RECEIPT_MODEL") ?? "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Extract receipt data into strict JSON with keys vendor, date, total, tax, order_number, confidence, items. " +
                "Each item must include description, qty, unit_price, total. Use null when unknown. Return JSON only.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}.`);
  }

  const data = await response.json();
  const outputText =
    data?.output_text ||
    data?.output?.flatMap((item: any) => item?.content || []).map((part: any) => part?.text || "").join("\n") ||
    "";

  return coerceParsedReceipt(safeJsonParse(outputText), "llm");
}

export async function extractReceipt(text: string) {
  const vendor = detectVendor(text);

  let parsed: ParsedReceipt;

  if (vendor === "lowes") {
    parsed = parseLowes(text);
  } else if (vendor === "homedepot") {
    parsed = parseHomeDepot(text);
  } else {
    parsed = await llmParse(text);
  }

  return scoreTotals(parsed);
}
