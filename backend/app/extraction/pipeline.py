from __future__ import annotations

from io import BytesIO

import pymupdf as fitz

from .vision import analyze_engineering_drawing


def _extract_text_fast(document: fitz.Document) -> str:
    try:
        return "\n".join(
            page.get_text("text") or ""
            for page in document
        )
    except Exception:
        return ""


def _title_crop_fast(document: fitz.Document) -> bytes | None:
    """
    Small compressed crop only.
    The original PDF is sent directly to Gemini, so we no longer render a
    huge 300-DPI full-page PNG before every analysis.
    """
    try:
        if document.page_count == 0:
            return None

        page = document[0]
        rect = page.rect

        clip = fitz.Rect(
            rect.x0,
            rect.y0 + rect.height * 0.60,
            rect.x1,
            rect.y1,
        )

        # Small title crop only for scanned/image PDFs.
        zoom = 120 / 72
        pix = page.get_pixmap(
            matrix=fitz.Matrix(zoom, zoom),
            clip=clip,
            alpha=False,
        )

        return pix.tobytes(
            "jpeg",
            jpg_quality=65,
        )
    except Exception:
        return None


def analyze_pdf_with_ai(pdf_bytes: bytes) -> dict:
    if not pdf_bytes:
        raise ValueError("Empty PDF.")

    document = fitz.open(
        stream=pdf_bytes,
        filetype="pdf",
    )

    try:
        if document.page_count == 0:
            raise ValueError("PDF contains no pages.")

        extracted_text = _extract_text_fast(document)

        # Vector/text PDFs already give Gemini the original PDF plus searchable
        # text, so generating another JPEG crop is redundant and slower.
        # Use the crop only when the PDF behaves like a scan.
        useful_text = extracted_text.strip()
        title_crop = (
            _title_crop_fast(document)
            if len(useful_text) < 250
            else None
        )
    finally:
        document.close()

    return analyze_engineering_drawing(
        pdf_bytes,
        extracted_pdf_text=extracted_text,
        title_crop_bytes=title_crop,
    )
