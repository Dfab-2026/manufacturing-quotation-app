from __future__ import annotations

import time

import os
from pathlib import Path
from typing import Optional, Literal

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field


load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")

if not API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY is missing. Add GEMINI_API_KEY=your_key to backend/.env"
    )

client = genai.Client(api_key=API_KEY)


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

Extract drawing number, revision, description, drawing_type, assembly_parts, material, thickness, dimensions, holes, threads, chamfers, bends, studs, welds, surface_finish, manufacturing_processes, notes, confidence and missing_or_uncertain.

For assemblies/weldments keep every component separate in BOM/item order. Never mix dimensions between components. Never invent values, material, dimensions, rates, labour hours, machine time or costs. Mark uncertain values for review."""
    response = client.models.generate_content(
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
A second attachment may be an enlarged title-block crop.

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
- Extract thickness only when the part is sheet/plate/strip and thickness is actually shown.
- For machined solid parts, thickness may be null.
- Extract weight only if visible/reliable. Do not estimate it.
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
            response = client.models.generate_content(
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

            return parsed.model_dump()

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
