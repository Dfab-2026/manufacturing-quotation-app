from __future__ import annotations

from io import BytesIO

import pymupdf as fitz
from PIL import Image


from .vision import analyze_engineering_drawing


def _extract_text_fast(document: fitz.Document) -> str:
    try:
        return "\n".join(
            page.get_text("text") or ""
            for page in document
        )
    except Exception:
        return ""




def _extract_layout_context(document: fitz.Document) -> str:
    """
    Compact deterministic page/block layout context.

    This is deliberately local (PyMuPDF) so the application gets document
    structure/evidence hints without requiring a second paid OCR service.
    """
    chunks: list[str] = []
    total = 0

    for page_index, page in enumerate(document):
        try:
            blocks = page.get_text("blocks") or []
        except Exception:
            blocks = []

        # Reading order: top-to-bottom, left-to-right.
        blocks = sorted(blocks, key=lambda b: (float(b[1]), float(b[0])))

        for block in blocks[:80]:
            if len(block) < 5:
                continue
            x0, y0, x1, y1, text = block[:5]
            clean = " ".join(str(text or "").split())
            if not clean:
                continue

            line = (
                f"p{page_index + 1} "
                f"bbox({float(x0):.1f},{float(y0):.1f},{float(x1):.1f},{float(y1):.1f}) "
                f"{clean}"
            )
            chunks.append(line)
            total += len(line)
            if total >= 7000:
                return "\n".join(chunks)

    return "\n".join(chunks)




def _shift_decode_candidate(text: str) -> str:
    """Decode common broken PDF font mappings enough to identify title-block labels.

    Some CAD PDFs expose text with a fixed character-code shift (for example
    ``:HLJKW`` renders visually as ``Weight``).  We do not use this decoded
    string as engineering data; it is only used to locate the visual label so
    we can crop the real pixels for Vision AI.
    """
    raw = str(text or "")
    if not raw:
        return ""
    lowered = raw.lower()
    if any(token in lowered for token in ("weight", "mass", "unit weight", "net weight")):
        return raw
    for shift in range(-40, 41):
        out = []
        for ch in raw:
            if ch in "\n\r\t ":
                out.append(ch)
                continue
            code = ord(ch)
            shifted = code + shift
            out.append(chr(shifted) if 32 <= shifted <= 126 else ch)
        candidate = "".join(out)
        lc = candidate.lower()
        if any(token in lc for token in ("weight", "mass", "net weight", "unit weight")):
            return candidate
    return raw


def _find_weight_label_rotated_rect(page: fitz.Page) -> fitz.Rect | None:
    """Locate a visible Weight/Mass label even when PDF text mapping is corrupt."""
    try:
        data = page.get_text("dict") or {}
    except Exception:
        return None
    for block in data.get("blocks") or []:
        for line in block.get("lines") or []:
            for span in line.get("spans") or []:
                text = _shift_decode_candidate(span.get("text") or "").lower()
                if not any(token in text for token in ("weight", "mass")):
                    continue
                bbox = span.get("bbox")
                if not bbox or len(bbox) != 4:
                    continue
                try:
                    return fitz.Rect(*bbox) * page.rotation_matrix
                except Exception:
                    continue
    return None


def _weight_row_crop_fast(document: fitz.Document) -> bytes | None:
    """Return a tight high-resolution visual crop around the printed weight row.

    This is intentionally pixel-based after locating the label.  It avoids
    trusting corrupt PDF character mappings while making small values such as
    ``3.53 kg`` occupy a large part of the AI input.
    """
    try:
        if document.page_count == 0:
            return None
        page = document[0]
        label = _find_weight_label_rotated_rect(page)
        if label is None:
            return None

        zoom = 260 / 72
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        image = Image.open(BytesIO(pix.tobytes("png"))).convert("RGB")

        # label is in rotated page coordinates; expand across the whole table row.
        x0 = max(0.0, label.x0 - 18.0)
        y0 = max(0.0, label.y0 - 10.0)
        x1 = min(page.rect.width, label.x1 + 190.0)
        y1 = min(page.rect.height, label.y1 + 16.0)

        box = (
            int(x0 * zoom),
            int(y0 * zoom),
            int(x1 * zoom),
            int(y1 * zoom),
        )
        cropped = image.crop(box)
        if cropped.width < 20 or cropped.height < 20:
            return None
        out = BytesIO()
        cropped.save(out, format="JPEG", quality=94, optimize=True)
        return out.getvalue()
    except Exception:
        return None

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
            rect.y0 + rect.height * 0.45,
            rect.x1,
            rect.y1,
        )

        # Enlarged title-block crop. 220 DPI materially improves small/faint
        # values such as "Weight: 3.53 kg" while still avoiding a full-page
        # high-resolution render.
        zoom = 220 / 72
        pix = page.get_pixmap(
            matrix=fitz.Matrix(zoom, zoom),
            clip=clip,
            alpha=False,
        )

        return pix.tobytes(
            "jpeg",
            jpg_quality=88,
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
        layout_context = _extract_layout_context(document)

        # Always provide a compact title-block crop. Some engineering PDFs use
        # embedded fonts whose text layer is long but character-mapped incorrectly.
        # In those files the PDF text looks "available" while values such as
        # WEIGHT/MASS are unreadable. The small crop gives Vision a deterministic
        # visual source without rendering the full drawing to a large bitmap.
        title_crop = _title_crop_fast(document)
        weight_crop = _weight_row_crop_fast(document)
    finally:
        document.close()

    return analyze_engineering_drawing(
        pdf_bytes,
        extracted_pdf_text=extracted_text,
        title_crop_bytes=title_crop,
        weight_crop_bytes=weight_crop,
        layout_context=layout_context,
    )
