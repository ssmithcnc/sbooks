import { NextResponse } from "next/server";

export const runtime = "nodejs";

function redirectWithParams(url: URL, params: Record<string, string>) {
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
}

export async function POST(request: Request) {
  const redirectUrl = new URL("/receipts/upload", request.url);
  return redirectWithParams(redirectUrl, {
    error: "The receipt uploader has been upgraded. Please reopen the upload page and submit again.",
  });
}
