"""Fast, offline-first text extraction for engineering drawings.

Never infer unseen dimensions from image appearance. Scanned documents require
an installed Tesseract OCR binary; without it the review stays explicitly incomplete.
"""
from __future__ import annotations

from io import BytesIO
import os

import pymupdf
from PIL import Image, ImageOps

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_PAGES = 30
MAX_TEXT = 100_000


def _ocr_image(image: Image.Image) -> tuple[str, str | None]:
    if os.getenv("LOCAL_OCR_ENABLED", "true").lower() not in {"true", "1", "yes"}:
        return "", "Local OCR is disabled. Enable LOCAL_OCR_ENABLED for scans."
    try:
        import pytesseract
        from pytesseract import TesseractNotFoundError
        # Keep latency and memory bounded; do not upscale huge drawings.
        image = ImageOps.exif_transpose(image).convert("L")
        image.thumbnail((2400, 2400))
        text = pytesseract.image_to_string(image, config="--psm 11", timeout=15)
        return text[:MAX_TEXT], None
    except Exception as exc:
        return "", f"Local OCR unavailable ({type(exc).__name__}). Install Tesseract or review the drawing manually."


def extract_local_text(content: bytes, filename: str) -> tuple[str, list[str]]:
    if not content or len(content) > MAX_FILE_BYTES:
        raise ValueError("Drawing must be non-empty and no larger than 25 MB.")
    suffix = filename.rsplit(".", 1)[-1].lower()
    warnings: list[str] = []
    if suffix == "pdf":
        try:
            document = pymupdf.open(stream=content, filetype="pdf")
        except Exception as exc:
            raise ValueError("PDF cannot be opened or is invalid.") from exc
        with document:
            if document.is_encrypted:
                raise ValueError("Password-protected PDFs are not supported.")
            if document.page_count > MAX_PAGES:
                raise ValueError(f"PDF has too many pages (maximum {MAX_PAGES}).")
            sections = []
            ocr_page_limit = max(0, min(30, int(os.getenv("LOCAL_OCR_MAX_PAGES", "6"))))
            for page in document:
                text = page.get_text("text", sort=True) or ""
                if len(text.strip()) < 16 and page.number >= ocr_page_limit:
                    warnings.append(f"Page {page.number + 1}: OCR skipped (LOCAL_OCR_MAX_PAGES limit); check this page manually.")
                elif len(text.strip()) < 16:
                    try:
                        pix = page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), alpha=False)
                        image = Image.open(BytesIO(pix.tobytes("png")))
                        ocr, warning = _ocr_image(image)
                        text = ocr or text
                        if warning:
                            warnings.append(f"Page {page.number + 1}: {warning}")
                    except Exception as exc:
                        warnings.append(f"Page {page.number + 1}: OCR could not process the scanned page.")
                sections.append(text)
            result = "\n".join(sections)[:MAX_TEXT]
            if not result.strip():
                warnings.append("No readable PDF text was found. Confirm material, dimensions and weight manually.")
            return result, warnings
    if suffix in {"jpg", "jpeg", "png", "webp", "tif", "tiff"}:
        try:
            image = Image.open(BytesIO(content))
            if image.width * image.height > 65_000_000:
                raise ValueError("Image resolution exceeds the supported limit.")
            text, warning = _ocr_image(image)
        except (OSError, Image.DecompressionBombError) as exc:
            raise ValueError("Uploaded drawing image could not be decoded.") from exc
        if warning:
            warnings.append(warning)
        if not text.strip():
            warnings.append("No reliable text detected in image. Verify all engineering fields manually.")
        return text, warnings
    raise ValueError(f"Unsupported local text extraction format: {suffix}")
