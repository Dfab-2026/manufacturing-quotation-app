from .ai_provider import ai_extract, ai_extract_text, merge_extractions
from .config import settings
from .models import Extraction
from .parser import extract_fields

VISUAL_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/tiff",
    "image/webp",
}

TEXT_OR_PACKAGE_MIME_TYPES = {
    "application/dxf",
    "application/step",
    "model/step",
    "model/iges",
    "application/iges",
    "application/zip",
}


def analyze_bytes(data: bytes, mime_type: str, file_name: str) -> Extraction:
    cfg = settings()
    ai_enabled = cfg.ai_provider.strip().lower() != "none"

    # PDF/image path: extract any cheap text layer locally, then let the vision
    # model read the actual drawing. Expensive OCR is only a fallback.
    if mime_type in VISUAL_MIME_TYPES:
        local = extract_fields(data, mime_type, ocr_fallback=not ai_enabled)
        ai = None
        if ai_enabled:
            try:
                ai = ai_extract(data, mime_type, file_name)
            except Exception as exc:
                local.warnings.append(f"AI visual analysis was unavailable: {str(exc)[:220]}")

        if ai is None and ai_enabled:
            local = extract_fields(data, mime_type, ocr_fallback=True)
        return merge_extractions(local, ai)

    # Text-based CAD and ZIP packages are normalized locally first. Sending raw
    # STEP/DXF/ZIP bytes to a vision endpoint is unreliable, so the normalized
    # engineering text is used as the AI context instead.
    if mime_type in TEXT_OR_PACKAGE_MIME_TYPES:
        local = extract_fields(
            data,
            mime_type,
            ocr_fallback=mime_type == "application/zip",
        )
        ai = None
        if ai_enabled and local.raw_text.strip():
            try:
                ai = ai_extract_text(local.raw_text, file_name)
            except Exception as exc:
                local.warnings.append(f"AI CAD/text analysis was unavailable: {str(exc)[:220]}")
        return merge_extractions(local, ai)

    # DWG/proprietary formats stay explicit: do not invent geometry. Local parser
    # records a review warning until a real DWG conversion connector is added.
    return extract_fields(data, mime_type, ocr_fallback=False)
