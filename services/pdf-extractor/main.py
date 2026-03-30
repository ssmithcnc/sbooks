import base64
import logging
from io import BytesIO

import pdfplumber
from fastapi import FastAPI, HTTPException

app = FastAPI(title="Receipt PDF Extractor")
logger = logging.getLogger("receipt-pdf-extractor")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/extract")
def extract(file: dict):
    base64_file = file.get("file")
    if not base64_file:
        raise HTTPException(status_code=400, detail="file is required")

    try:
        pdf_bytes = base64.b64decode(base64_file)
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("Invalid base64 payload")
        raise HTTPException(status_code=400, detail="invalid base64 payload") from exc

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
