export async function extractPdfText(base64File: string) {
  const url = Deno.env.get("PDF_SERVICE_URL");
  if (!url) {
    throw new Error("PDF_SERVICE_URL is not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: base64File }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PDF service failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return {
    text: String(data?.text || ""),
    page_count: typeof data?.page_count === "number" ? data.page_count : null,
  };
}
