import io
import re
import zipfile
import fitz
import pytesseract
from PIL import Image
from .models import Evidence, Extraction


MATERIAL_PATTERNS = [
    r"\b(?:MATERIAL|MATL|MAT\.)\s*[:\-]?\s*([A-Z0-9][A-Z0-9 .\-/]{1,40})",
    r"\b(SS\s*304L?|SS\s*316L?|AISI\s*304L?|AISI\s*316L?|IS\s*2062|AL\s*6061|EN\s*8|MS)\b",
]

TEXT_CAD_MIME_TYPES = {
    "application/dxf",
    "application/step",
    "model/step",
    "model/iges",
    "application/iges",
    "text/plain",
}
IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/tiff", "image/webp"}


def _match(text: str, patterns: list[str], group: int = 1, confidence: float = 0.94) -> Evidence:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            value = match.group(group).strip().rstrip(";,")
            return Evidence(value=value, source="drawing", confidence=confidence, evidence=match.group(0)[:160])
    return Evidence()


def _number(text: str, patterns: list[str], confidence: float = 0.9) -> Evidence:
    found = _match(text, patterns, confidence=confidence)
    if found.value is None:
        return found
    value = str(found.value).replace(",", "")
    try:
        found.value = float(value)
    except ValueError:
        return Evidence()
    return found


def _decode_cad_text(data: bytes) -> str:
    for encoding in ("utf-8", "latin-1"):
        try:
            return data.decode(encoding, errors="strict")
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="ignore")


def _extract_zip_text(data: bytes, *, ocr_fallback: bool = True) -> tuple[str, list[str]]:
    warnings = ["ZIP package analyzed file-by-file using supported embedded drawing formats."]
    chunks: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()][:50]
        for item in members:
            name = item.filename.lower()
            if item.file_size > 25 * 1024 * 1024:
                continue
            payload = archive.read(item)
            try:
                if name.endswith(".pdf"):
                    text, child_warnings = extract_text(payload, "application/pdf", ocr_fallback=ocr_fallback)
                elif name.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp")):
                    text, child_warnings = extract_text(payload, "image/png", ocr_fallback=ocr_fallback)
                elif name.endswith((".dxf", ".step", ".stp", ".iges", ".igs")):
                    text, child_warnings = extract_text(payload, "application/dxf", ocr_fallback=ocr_fallback)
                else:
                    continue
                chunks.append(f"\n--- FILE: {item.filename} ---\n{text}")
                warnings.extend(child_warnings)
            except Exception:
                warnings.append(f"Could not parse embedded file: {item.filename}")
    if not chunks:
        warnings.append("No directly readable PDF, image, DXF, STEP or IGES content was found in the ZIP package.")
    return "\n".join(chunks), warnings


def extract_text(data: bytes, mime_type: str, *, ocr_fallback: bool = True) -> tuple[str, list[str]]:
    warnings: list[str] = []
    if mime_type == "application/pdf":
        doc = fitz.open(stream=data, filetype="pdf")
        pages = [page.get_text("text", sort=True) for page in doc]
        text = "\n".join(pages).strip()
        if len(text) >= 80:
            return text, warnings
        if not ocr_fallback:
            warnings.append("PDF text layer was sparse; local OCR deferred because AI visual analysis is enabled.")
            return text, warnings
        warnings.append("PDF text layer was sparse; OCR fallback attempted.")
        ocr_pages: list[str] = []
        try:
            for page in doc:
                pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
                image = Image.open(io.BytesIO(pix.tobytes("png")))
                ocr_pages.append(pytesseract.image_to_string(image, config="--psm 6"))
            return "\n".join(ocr_pages), warnings
        except Exception as exc:
            warnings.append(f"Local OCR is unavailable; continuing without it: {str(exc)[:180]}")
            return text, warnings

    if mime_type in IMAGE_MIME_TYPES:
        if not ocr_fallback:
            warnings.append("Local image OCR deferred because AI visual analysis is enabled.")
            return "", warnings
        try:
            image = Image.open(io.BytesIO(data))
            return pytesseract.image_to_string(image, config="--psm 6"), warnings
        except Exception as exc:
            warnings.append(f"Local OCR is unavailable; continuing without it: {str(exc)[:180]}")
            return "", warnings

    if mime_type == "application/zip":
        return _extract_zip_text(data, ocr_fallback=ocr_fallback)

    if mime_type in TEXT_CAD_MIME_TYPES:
        warnings.append("CAD text entities were parsed directly; geometry-specific values still require engineering review.")
        return _decode_cad_text(data), warnings

    if mime_type in {"application/acad", "application/x-dwg", "image/vnd.dwg"}:
        warnings.append("DWG is a proprietary binary format. The file is stored and tracked, but exact geometry extraction requires a DWG conversion service or CAD connector.")
        return "", warnings

    try:
        if not ocr_fallback:
            warnings.append("Local OCR deferred because AI visual analysis is enabled.")
            return "", warnings
        image = Image.open(io.BytesIO(data))
        return pytesseract.image_to_string(image, config="--psm 6"), warnings
    except Exception:
        warnings.append("No local parser is available for this drawing format; AI/provider extraction may still add values.")
        return "", warnings


def extract_fields(data: bytes, mime_type: str, *, ocr_fallback: bool = True) -> Extraction:
    text, warnings = extract_text(data, mime_type, ocr_fallback=ocr_fallback)
    normalized = re.sub(r"[\t ]+", " ", text)

    result = Extraction(raw_text=text[:200_000], warnings=warnings)
    result.drawing_number = _match(normalized, [
        r"(?:DRAWING\s*(?:NO\.?|NUMBER)|DWG\s*NO\.?)\s*[:#\-]?\s*([A-Z0-9_.\-/]+)",
        r"(?:PART\s*NO\.?)\s*[:#\-]?\s*([A-Z0-9_.\-/]+)",
    ])
    result.revision = _match(normalized, [r"(?:REVISION|REV\.?)\s*[:#\-]?\s*([A-Z0-9]{1,8})"], confidence=0.93)
    result.description = _match(normalized, [r"(?:TITLE|DESCRIPTION|PART\s*NAME)\s*[:\-]?\s*([^\n]{2,100})"], confidence=0.82)
    result.material = _match(normalized, MATERIAL_PATTERNS, confidence=0.9)
    result.quantity = _number(normalized, [r"(?:QTY|QUANTITY)\s*[:\-]?\s*(\d+(?:\.\d+)?)"])
    result.drawing_weight_kg = _number(normalized, [
        r"(?:NET\s*)?WEIGHT\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:KG|KGS)\b",
        r"MASS\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:KG|KGS)\b",
    ], confidence=0.97)
    result.thickness_mm = _number(normalized, [
        r"(?:THK|THICKNESS|THK\.)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b",
        r"\bT\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b",
    ])
    result.diameter_mm = _number(normalized, [r"(?:DIA(?:METER)?|Ø|⌀)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b"], confidence=0.86)
    result.tolerance = _match(normalized, [r"(?:GENERAL\s+)?TOLERANCE(?:S)?\s*[:\-]?\s*([^\n]{2,120})", r"TOL\.\s*[:\-]?\s*([^\n]{2,120})"], confidence=0.82)
    result.surface_finish = _match(normalized, [r"SURFACE\s*(?:FINISH|ROUGHNESS)\s*[:\-]?\s*([^\n]{2,120})", r"(?:RA|RZ)\s*[:=]?\s*([0-9.]+\s*(?:UM|ΜM|MICRON)?)"], confidence=0.84)
    result.weld_details = _match(normalized, [r"(?:WELD|WELDING)\s*(?:DETAILS?|NOTE)?\s*[:\-]?\s*([^\n]{2,160})"], confidence=0.78)
    result.hole_thread_details = _match(normalized, [r"(?:HOLE|THREAD|TAP|TAPPED)\s*(?:DETAILS?|NOTE)?\s*[:\-]?\s*([^\n]{2,160})", r"\b(M\d+(?:\.\d+)?\s*[xX]\s*[0-9.]+(?:\s*PITCH)?)\b"], confidence=0.76)
    result.heat_treatment = _match(normalized, [r"HEAT\s*TREAT(?:MENT)?\s*[:\-]?\s*([^\n]{2,120})", r"HARDNESS\s*[:\-]?\s*([^\n]{2,120})"], confidence=0.82)
    result.coating = _match(normalized, [r"(?:COATING|PAINT|PLATING|GALVANIZING|POWDER\s*COAT)\s*[:\-]?\s*([^\n]{2,120})"], confidence=0.82)

    overall = re.search(
        r"(?:OVERALL|O/?A|SIZE|DIMENSIONS?)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:MM)?",
        normalized,
        re.IGNORECASE,
    )
    if overall:
        values = [float(overall.group(i)) for i in range(1, 4)]
        evidence = overall.group(0)[:160]
        # Preserve the printed order instead of sorting dimensions. Most title
        # blocks/specifications express overall size as L × W × T; sorting can
        # silently swap width and thickness and corrupt weight calculations.
        result.length_mm = Evidence(value=values[0], source="drawing", confidence=0.9, evidence=evidence)
        result.width_mm = Evidence(value=values[1], source="drawing", confidence=0.9, evidence=evidence)
        if result.thickness_mm.value is None:
            result.thickness_mm = Evidence(value=values[2], source="drawing", confidence=0.82, evidence=evidence)
        result.warnings.append("Overall size was mapped in printed L × W × T order; verify if this drawing uses another convention.")

    if not text.strip():
        result.warnings.append("No readable drawing text could be extracted locally.")
    if result.material.value is None:
        result.warnings.append("Material was not confidently identified.")
    return result
