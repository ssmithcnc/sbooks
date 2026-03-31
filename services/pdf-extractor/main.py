import base64
import logging
from io import BytesIO

import pdfplumber
from fastapi import FastAPI, HTTPException
from pypdf import PdfReader, PdfWriter

app = FastAPI(title="Receipt PDF Extractor")
logger = logging.getLogger("receipt-pdf-extractor")


def decode_pdf(base64_file: str) -> bytes:
    try:
        return base64.b64decode(base64_file)
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("Invalid base64 payload")
        raise HTTPException(status_code=400, detail="invalid base64 payload") from exc


def parse_pages_to_keep(value: str, total_pages: int) -> list[int]:
    if not value or not value.strip():
        raise HTTPException(status_code=400, detail="pages is required")

    pages: list[int] = []

    for chunk in value.split(","):
        part = chunk.strip()
        if not part:
            continue

        if "-" in part:
            start_text, end_text = part.split("-", 1)
            if not start_text.isdigit() or not end_text.isdigit():
                raise HTTPException(status_code=400, detail=f"invalid page range: {part}")
            start = int(start_text)
            end = int(end_text)
            if start < 1 or end < start:
                raise HTTPException(status_code=400, detail=f"invalid page range: {part}")
            pages.extend(range(start, end + 1))
        else:
            if not part.isdigit():
                raise HTTPException(status_code=400, detail=f"invalid page number: {part}")
            pages.append(int(part))

    deduped = []
    seen = set()
    for page in pages:
        if page < 1 or page > total_pages:
            raise HTTPException(status_code=400, detail=f"page {page} is outside 1-{total_pages}")
        if page not in seen:
            seen.add(page)
            deduped.append(page)

    if not deduped:
        raise HTTPException(status_code=400, detail="no pages selected")

    return [page - 1 for page in deduped]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/extract")
def extract(file: dict):
    base64_file = file.get("file")
    if not base64_file:
        raise HTTPException(status_code=400, detail="file is required")

    pdf_bytes = decode_pdf(base64_file)

    text_parts = []
    page_count = 0

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_count += 1
                text_parts.append((page.extract_text() or "").strip())
    except Exception as exc:
        logger.exception("PDF extraction failed")
        raise HTTPException(status_code=500, detail="pdf extraction failed") from exc

    return {
        "text": "\n\n".join(part for part in text_parts if part).strip(),
        "page_count": page_count,
    }


@app.post("/trim")
def trim(file: dict):
    base64_file = file.get("file")
    pages_to_keep = str(file.get("pages") or "").strip()
    if not base64_file:
        raise HTTPException(status_code=400, detail="file is required")

    pdf_bytes = decode_pdf(base64_file)

    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        page_indexes = parse_pages_to_keep(pages_to_keep, len(reader.pages))
        writer = PdfWriter()

        for page_index in page_indexes:
            writer.add_page(reader.pages[page_index])

        output = BytesIO()
        writer.write(output)
        trimmed_bytes = output.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("PDF trim failed")
        raise HTTPException(status_code=500, detail="pdf trim failed") from exc

    return {
        "file": base64.b64encode(trimmed_bytes).decode("utf-8"),
        "page_count": len(page_indexes),
        "byte_size": len(trimmed_bytes),
    }
