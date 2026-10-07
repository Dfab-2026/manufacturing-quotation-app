from __future__ import annotations

import time

import os
from pathlib import Path
from typing import Optional, Literal

from dotenv import load_dotenv
try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None
from pydantic import BaseModel, Field


load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")

client = genai.Client(api_key=API_KEY) if (genai is not None and API_KEY) else None

def _require_ai_client():
    if genai is None or types is None:
        raise RuntimeError("google-genai is not installed correctly. Run: pip install -U google-genai")
    if not API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing. Add GEMINI_API_KEY=your_key to backend/.env")
    if client is None:
        raise RuntimeError("Gemini client is unavailable.")
    return client


# -----------------------------
# Structured engineering schema
# -----------------------------

class Material(BaseModel):
    family: str = ""
    grade: str = ""
    specification: str = ""


class Dimension(BaseModel):
    label: str = ""
    value_mm: Optional[float] = None
    original_value: Optional[float] = None
    original_unit: str = "mm"
    callout: str = ""
    tolerance: str = ""
    quantity: int = 1
    confidence: int = Field(default=0, ge=0, le=100)


class Hole(BaseModel):
    diameter_mm: Optional[float] = None
    quantity: int = 0
    type: str = ""
    callout: str = ""
    confidence: int = Field(default=0, ge=0, le=100)


class ThreadFeature(BaseModel):
    designation: str = ""
    quantity: int = 0
    through: bool = False
    confidence: int = Field(default=0, ge=0, le=100)


class Chamfer(BaseModel):
    size_mm: Optional[float] = None
    angle_deg: Optional[float] = None
    quantity: int = 0
    confidence: int = Field(default=0, ge=0, le=100)


class Bend(BaseModel):
    angle_deg: Optional[float] = None
    quantity: int = 0
    confidence: int = Field(default=0, ge=0, le=100)


class Stud(BaseModel):
    size: str = ""
    length_mm: Optional[float] = None
    quantity: int = 0
    material: str = ""
    confidence: int = Field(default=0, ge=0, le=100)


class Weld(BaseModel):
    type: str = ""
    size_mm: Optional[float] = None
    length_mm: Optional[float] = None
    location: str = ""
    quantity: int = 0
    confidence: int = Field(default=0, ge=0, le=100)


class ManufacturingProcess(BaseModel):
    process: str = ""
    reason: str = ""
    confidence: int = Field(default=0, ge=0, le=100)


class AssemblyPart(BaseModel):
    item_no: str = ""
    part_name: str = ""
    drawing_no: str = ""
    quantity: int = 1
    material: str = ""
    length_mm: Optional[float] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    thickness_mm: Optional[float] = None
    description: str = ""
    confidence: int = Field(default=0, ge=0, le=100)




class EngineeringEvidence(BaseModel):
    field: str = ""
    value: str = ""
    basis: str = ""
    page: int = Field(default=0, ge=0, le=999)
    confidence: int = Field(default=0, ge=0, le=100)

class Confidence(BaseModel):
    drawing_no: int = Field(default=0, ge=0, le=100)
    revision: int = Field(default=0, ge=0, le=100)
    description: int = Field(default=0, ge=0, le=100)
    material: int = Field(default=0, ge=0, le=100)
    thickness: int = Field(default=0, ge=0, le=100)
    weight: int = Field(default=0, ge=0, le=100)
    quantity: int = Field(default=0, ge=0, le=100)
    dimensions: int = Field(default=0, ge=0, le=100)
    processes: int = Field(default=0, ge=0, le=100)
    classification: int = Field(default=0, ge=0, le=100)




class PrintedWeightDetection(BaseModel):
    found: bool = False
    value: Optional[float] = None
    unit: str = ""
    weight_kg: Optional[float] = None
    label: str = ""
    evidence: str = ""
    confidence: int = Field(default=0, ge=0, le=100)


def detect_printed_weight_from_image(image_bytes: bytes) -> PrintedWeightDetection:
    """
    Focused second-pass reader for title blocks.

    This intentionally does one job only: read a visibly printed drawing weight.
    It must never calculate mass from dimensions or infer a likely value.
    """
    if not image_bytes:
        return PrintedWeightDetection()

    prompt = """You are reading ONLY the title block / notes region of an engineering drawing.

Your single task is to find a visibly PRINTED product mass/weight.
Look carefully for labels such as WEIGHT, WT, MASS, NET WEIGHT, UNIT WEIGHT, APPROX. WEIGHT, or similar title-block wording.

Rules:
- Do NOT calculate or estimate weight from geometry, material, dimensions, density, or part type.
- Do NOT use unrelated numeric values such as drawing number, revision, dimensions, pressure rating, DN size, dates, quantities, or item numbers.
- Return found=true only when you can see a weight/mass label and its numeric value in the image.
- Copy the visible number exactly into value.
- Copy the visible unit into unit. Supported units include kg, g, lb/lbs, and tonne/t.
- Convert only the unit into weight_kg: 1000 g = 1 kg; 1 lb = 0.45359237 kg; 1 tonne = 1000 kg.
- Put the exact visible label/value wording into evidence, for example "Weight: 3.53 kg".
- If the value or unit is unclear, return found=false rather than guessing.

The image may be a very tight crop containing only one title-block row. Read the label and the adjacent value cell carefully, including faint decimal digits.\nRead small/faint text carefully."""

    response = _require_ai_client().models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        contents=[prompt, types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=PrintedWeightDetection,
            temperature=0,
        ),
    )
    if not response.text:
        return PrintedWeightDetection()
    return PrintedWeightDetection.model_validate_json(response.text)


class EngineeringDrawingExtraction(BaseModel):
    drawing_no: str = ""
    revision: str = ""
    description: str = ""

    # Two-axis classification: what document is this, and how is it manufactured?
    drawing_type: str = "part"
    document_type: Literal[
        "Part Drawing",
        "Assembly Drawing",
        "General Arrangement",
        "Weldment / Fabrication Drawing",
        "Detail Drawing",
    ] = "Part Drawing"
    primary_manufacturing_type: str = ""
    manufacturing_types: list[str] = Field(default_factory=list)
    part_form: str = "Unknown"
    classification_confidence: int = Field(default=0, ge=0, le=100)
    process_route: list[str] = Field(default_factory=list)
    evidence: list[EngineeringEvidence] = Field(default_factory=list)

    assembly_parts: list[AssemblyPart] = Field(default_factory=list)

    material: Material = Field(default_factory=Material)

    thickness_mm: Optional[float] = None
    weight_kg: Optional[float] = None
    product_quantity: int = 1

    dimensions: list[Dimension] = Field(default_factory=list)
    holes: list[Hole] = Field(default_factory=list)
    threads: list[ThreadFeature] = Field(default_factory=list)
    chamfers: list[Chamfer] = Field(default_factory=list)
    bends: list[Bend] = Field(default_factory=list)
    studs: list[Stud] = Field(default_factory=list)
    welds: list[Weld] = Field(default_factory=list)

    surface_finish: list[str] = Field(default_factory=list)

    manufacturing_processes: list[ManufacturingProcess] = Field(
        default_factory=list
    )

    notes: list[str] = Field(default_factory=list)

    confidence: Confidence = Field(default_factory=Confidence)

    missing_or_uncertain: list[str] = Field(default_factory=list)


def analyze_engineering_media(content_bytes: bytes, mime_type: str) -> dict:
    if not content_bytes:
        raise ValueError("No media bytes were supplied.")
    prompt = """You are a senior manufacturing engineer and manufacturing-process planner. Analyze this engineering drawing image.

Return structured engineering data and classify it on TWO independent axes:
1) document_type: Part Drawing, Assembly Drawing, General Arrangement, Weldment / Fabrication Drawing, or Detail Drawing.
2) manufacturing route: primary_manufacturing_type plus manufacturing_types and ordered process_route.

Also identify part_form such as Plate, Sheet, Block / Prismatic, Shaft / Cylindrical, Flange, Bracket, Frame, Tube / Pipe, Enclosure / Cover, Gear, Casting, Assembly, Standard Part, or Unknown.

For classification, provide classification_confidence 0-100 and evidence rows. Each evidence row must name the field/value, state the exact drawing basis/callout/geometry signal, page when known, and confidence.

Extract drawing number, revision, description, drawing_type, assembly_parts, material, thickness, dimensions, holes, threads, chamfers, bends, studs, welds, surface_finish, manufacturing_processes, notes, confidence and missing_or_uncertain. If the drawing prints WEIGHT, WT, MASS, NET WEIGHT or UNIT WEIGHT, treat that printed value as authoritative and return it in weight_kg; do not replace a printed weight with a geometry estimate. Normalize explicit weight units to kilograms (1 lb = 0.45359237 kg; 1000 g = 1 kg). If no explicit weight/mass is printed, leave weight_kg empty; the application will calculate a fallback from dimensions, thickness and material density. For every dimension, normalize the engineering value to millimetres in value_mm. If the source uses inches/feet/cm/metres, also return original_value, original_unit and the visible callout so the conversion is auditable. Use exactly 1 in = 25.4 mm, 1 ft = 304.8 mm, 1 cm = 10 mm, 1 m = 1000 mm. For plate/sheet/bracket/cover/panel parts, thickness is a required engineering output whenever it can be derived from a THK/T callout, L x W x T stock size, section/detail view, BOM row, or clearly uniform-thickness geometry. If inferred, return the best engineering estimate with reduced confidence and explain the basis in evidence/notes. Also extract complete geometry and quantity so the application can calculate weight from material density.

For assemblies/weldments keep every component separate in BOM/item order. Never mix dimensions between components. Never invent prices, rates, labour hours, machine time or costs. Engineering inferences are allowed only when directly supported by drawing geometry/callouts and must be marked with lower confidence and evidence. Mark unresolved values for review."""
    response = _require_ai_client().models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        contents=[prompt, types.Part.from_bytes(data=content_bytes, mime_type=mime_type)],
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=EngineeringDrawingExtraction, temperature=0.1),
    )
    if not response.text:
        raise RuntimeError("Gemini returned an empty response.")
    return EngineeringDrawingExtraction.model_validate_json(response.text).model_dump()


def analyze_engineering_drawing(
    pdf_bytes: bytes,
    extracted_pdf_text: str = "",
    title_crop_bytes: bytes | None = None,
    weight_crop_bytes: bytes | None = None,
    layout_context: str = "",
) -> dict:
    """
    Fast path:
    - send the original PDF directly to Gemini
    - optionally add one compact title-block JPEG crop
    - keep the same structured extraction schema
    """
    if not pdf_bytes:
        raise ValueError("No PDF bytes were supplied.")

    prompt = """
You are a senior manufacturing engineer.

Analyze the attached engineering drawing with very high care.

The primary attachment is the original engineering PDF.
A second attachment is an enlarged title-block crop. Treat that crop as the preferred source for title-block values such as drawing number, revision, material and especially printed WEIGHT/MASS.

Extract all useful manufacturing information visible in the drawing.

Important:
- Read the title block, notes, section views and every dimension callout.
- Read drawing number and revision from the drawing itself.
- First classify drawing_type as one of: part, assembly, weldment, sheet_metal, machining, mixed.
- Separately classify document_type as exactly one of: Part Drawing, Assembly Drawing, General Arrangement, Weldment / Fabrication Drawing, Detail Drawing.
- Separately classify primary_manufacturing_type and manufacturing_types. A document can be an Assembly Drawing while its components require machining, laser cutting, bending and welding. Never confuse document type with manufacturing type.
- Determine part_form such as Plate, Sheet, Block / Prismatic, Shaft / Cylindrical, Flange, Bracket, Frame, Tube / Pipe, Enclosure / Cover, Gear, Casting, Assembly, Standard Part, or Unknown.
- Return classification_confidence 0-100.
- Return an ordered process_route from raw material/preparation through manufacturing, finishing and inspection.
- Return evidence rows for important classifications and extracted values. Each evidence row should include field, value, basis (the visible note/callout/geometry signal), page number when known, and confidence.
- If this is an ASSEMBLY / GA / weldment drawing, do NOT collapse all geometry into one part.
- Extract every identifiable component separately into assembly_parts in BOM/item-number order.
- For each assembly component capture item number, part name, drawing number, quantity, material, length, width, height, thickness and description when visible.
- Example: Plate 1 must be one row with its own L/W/T; Plate 2 must be the next independent row; Plate 3 another row. Never mix dimensions from different components.
- If a component dimension is not visible/reliable, keep it null and lower confidence instead of inventing it.
- Extract material FAMILY, GRADE and SPECIFICATION separately.
- For sheet/plate/strip/bracket/cover/panel parts, thickness is a REQUIRED engineering output whenever it can be derived. Determine it with this priority: explicit THK/T/thickness callout; plate/stock size such as L x W x T; section/detail view; BOM/component thickness; then the smallest physical axis when the drawing clearly represents a uniform-thickness part. If inferred, return the best engineering estimate with lower confidence and record the exact basis in evidence/notes. Do not leave thickness null merely because the word THK is absent. Do not make arbitrary standard-gauge assumptions.
- For assemblies/weldments, populate thickness_mm independently for every plate/sheet component when its own geometry/callout supports it; never copy one component thickness to another unless the drawing explicitly indicates they are the same.
- For machined solid parts, thickness may be null unless a meaningful stock/section thickness can be inferred.
- Never invent a thickness merely to make costing work. If no reliable thickness is visible or inferable, return thickness_mm=null. The application may use an internal temporary costing fallback, but that fallback must never be presented as a drawing-extracted thickness.
- WIDTH and HEIGHT are REQUIRED weight-basis outputs whenever two overall orthogonal dimensions are visible. Prefer dimensions explicitly labelled WIDTH/HEIGHT; otherwise use the two overall envelope dimensions shown by the principal views and record the basis in evidence. Do not confuse hole diameters, radii, chamfers, pitch, thread sizes or local feature dimensions with the product width/height.
- When a drawing shows an overall size as W x H, L x W, SIZE A x B, plate/blank size, or two clear overall dimensions on orthogonal views, return both values in dimensions with meaningful labels even if the title block does not name them.
- Extract weight ONLY when a value is visibly printed beside a title-block/notes label such as WEIGHT, WT, MASS, NET WEIGHT or UNIT WEIGHT. A printed drawing weight is authoritative: copy the exact visible number and unit, convert only the unit to kg, return it in weight_kg, and add an evidence row whose field is Weight and whose basis quotes the visible label/value. Do NOT calculate, estimate or infer weight inside this model. If no explicit printed weight is visible, return weight_kg=null. Geometry calculation is handled later by the application.
- Normalize ALL linear measurements to millimetres before returning them. Imperial drawings are valid inputs: convert inch/in/" using 25.4 mm per inch and foot/ft/' using 304.8 mm per foot. Also convert cm using 10 mm/cm and metres using 1000 mm/m. For each dimension preserve original_value, original_unit and the visible callout while value_mm contains the converted millimetre value. Fractions such as 1/2", 3/4", 1-1/4" and decimal inches must be converted accurately.
- If weight is not printed, prioritize extracting the complete geometry needed for deterministic mass calculation: material, quantity, overall length/width/height, diameter/OD/ID, wall thickness and component sizes. For plate/bracket/panel/cover-like products the application will deterministically fall back to WIDTH × HEIGHT × normalized thickness × density when a more exact volume is unavailable, and then add its configured allowance.
- Product quantity is REQUIRED when visible in the title block, BOM, item balloon, note or quantity callout.
- Capture overall dimensions and important feature dimensions.
- Capture hole diameter, quantity, THRU/slot/counterbore/countersink notes.
- Capture metric threads such as M16-6H THRU.
- Capture chamfers such as 3 x 45 degrees and 0.5 x 45 degrees.
- Capture bend angles/quantities when applicable.
- Capture studs/fasteners.
- Capture welding instructions and tack/full weld notes.
- Capture deburr, grinding, polishing, passivation and surface-treatment notes.
- Recommend likely manufacturing processes from geometry as well as explicit notes.
- For a uniform-thickness sheet/plate profile, consider sheet-metal blanking such as laser cutting; bends imply press-brake forming.
- For rotationally symmetric shafts/pins/bushes/cylindrical solids, prefer CNC turning as the primary machining route.
- For prismatic/block-like solid parts with pockets, flats, slots or multi-face features, prefer CNC milling.
- Holes can imply drilling/boring, threads can imply tapping/threading, and chamfers can imply chamfering.
- If more than one process is plausible, include the most likely sequence with a short reason.
- Recognize casting, forging, extrusion, tube/pipe fabrication, purchased/standard parts and additive manufacturing when the drawing actually supports them.
- Assembly/GA drawings should identify Assembly / Integration as a route stage but also list the actual processes required by individual components.
- Never invent material price, process rate, labour hours or quotation cost.
- Never use the filename as a substitute for reading the drawing.
- Use confidence 0-100 for extracted values.
- Put anything ambiguous into missing_or_uncertain.
"""

    if extracted_pdf_text.strip():
        prompt += (
            "\n\nSECONDARY PDF TEXT (may be corrupted):\n"
            + extracted_pdf_text[:4000]
        )

    if layout_context.strip():
        prompt += (
            "\n\nDOCUMENT LAYOUT BLOCKS (page + bounding-box context; use as supporting evidence, not as a reason to invent values):\n"
            + layout_context[:7000]
        )

    contents: list[object] = [
        prompt,
        types.Part.from_bytes(
            data=pdf_bytes,
            mime_type="application/pdf",
        ),
    ]

    if title_crop_bytes:
        contents.append(
            types.Part.from_bytes(
                data=title_crop_bytes,
                mime_type="image/jpeg",
            )
        )

    last_error: Exception | None = None

    for attempt in range(1, 3):
        try:
            response = _require_ai_client().models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=EngineeringDrawingExtraction,
                    temperature=0.1,
                ),
            )

            if not response.text:
                raise RuntimeError("Gemini returned an empty response.")

            parsed = EngineeringDrawingExtraction.model_validate_json(
                response.text
            )

            result = parsed.model_dump()

            # Weight is a first-class engineering field. If the main extraction
            # did not return a proven printed value, run one focused title-block
            # pass instead of allowing a geometry estimate to masquerade as a
            # drawing value. This extra call happens only for missing/unproven
            # weight and is deliberately narrow for speed and reliability.
            weight_evidence = [
                row for row in (result.get("evidence") or [])
                if isinstance(row, dict)
                and any(token in str(row.get("field") or "").lower() for token in ("weight", "mass", "wt"))
                and int(row.get("confidence") or 0) >= 60
            ]
            has_proven_weight = bool(result.get("weight_kg")) and bool(weight_evidence)

            focused_weight_image = weight_crop_bytes or title_crop_bytes
            if not has_proven_weight and focused_weight_image:
                try:
                    focused = detect_printed_weight_from_image(focused_weight_image)
                    if focused.found and focused.weight_kg and focused.weight_kg > 0 and focused.confidence >= 50:
                        result["weight_kg"] = float(focused.weight_kg)
                        result["drawing_stated_weight_kg"] = float(focused.weight_kg)
                        result["weight_source"] = "drawing_stated"
                        result.setdefault("evidence", []).append({
                            "field": "Weight",
                            "value": f"{focused.weight_kg:g} kg",
                            "basis": focused.evidence or f"{focused.label}: {focused.value} {focused.unit}",
                            "page": 1,
                            "confidence": int(focused.confidence),
                        })
                        confidence = result.setdefault("confidence", {})
                        if isinstance(confidence, dict):
                            confidence["weight"] = max(int(confidence.get("weight") or 0), int(focused.confidence))
                        result.setdefault("notes", []).append(
                            f"Focused title-block weight detection: {focused.weight_kg:g} kg"
                        )
                except Exception as weight_exc:
                    # Never fail the full drawing extraction merely because the
                    # focused weight reader could not complete. The application
                    # can still use deterministic geometry fallback later.
                    result.setdefault("missing_or_uncertain", []).append(
                        f"Printed weight requires review ({weight_exc})"
                    )

            return result

        except Exception as exc:
            last_error = exc
            message = str(exc).upper()

            # Quota/rate-limit errors usually do not recover in a few seconds,
            # so return them immediately instead of making the user wait.
            rate_limited = any(
                marker in message
                for marker in (
                    "429",
                    "RESOURCE_EXHAUSTED",
                    "RATE LIMIT",
                )
            )

            service_transient = any(
                marker in message
                for marker in (
                    "503",
                    "UNAVAILABLE",
                    "TIMEOUT",
                    "DEADLINE_EXCEEDED",
                )
            )

            if rate_limited or not service_transient or attempt >= 2:
                raise

            # One short retry for genuine transient service failures only.
            time.sleep(0.8)

    raise RuntimeError(
        f"Gemini extraction failed: {last_error}"
    )
