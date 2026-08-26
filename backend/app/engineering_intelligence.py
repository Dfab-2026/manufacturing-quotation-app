from __future__ import annotations

from typing import Any
import math
import re

DOCUMENT_TYPES = [
    "Part Drawing",
    "Assembly Drawing",
    "General Arrangement",
    "Weldment / Fabrication Drawing",
    "Detail Drawing",
]

MANUFACTURING_TYPES = [
    "CNC Milling",
    "CNC Turning",
    "General Machining",
    "Laser Cutting",
    "Sheet-Metal Fabrication",
    "Welding / Fabrication",
    "Drilling / Boring",
    "Threading / Tapping",
    "Grinding / Finishing",
    "Casting",
    "Forging",
    "Extrusion",
    "Tube / Pipe Fabrication",
    "Additive Manufacturing",
    "Purchased / Standard Part",
    "Assembly / Integration",
    "Inspection & Handling",
]

PART_FORMS = [
    "Plate",
    "Sheet",
    "Block / Prismatic",
    "Shaft / Cylindrical",
    "Flange",
    "Bracket",
    "Frame",
    "Tube / Pipe",
    "Enclosure / Cover",
    "Gear",
    "Casting",
    "Assembly",
    "Standard Part",
    "Unknown",
]

_PROCESS_PRIORITY = [
    "Casting",
    "Forging",
    "Extrusion",
    "Laser Cutting",
    "Sheet-Metal Fabrication",
    "CNC Turning",
    "CNC Milling",
    "General Machining",
    "Drilling / Boring",
    "Threading / Tapping",
    "Welding / Fabrication",
    "Tube / Pipe Fabrication",
    "Grinding / Finishing",
    "Additive Manufacturing",
    "Purchased / Standard Part",
    "Assembly / Integration",
    "Inspection & Handling",
]


def _norm(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())


def _clamp(value: Any, low: int = 0, high: int = 100) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        number = 0
    return max(low, min(high, number))


def _unique(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = str(value or "").strip()
        if not clean:
            continue
        key = clean.casefold()
        if key in seen:
            continue
        seen.add(key)
        output.append(clean)
    return output


def _process_entries(ai_raw: dict) -> list[dict]:
    return [
        item for item in (ai_raw.get("manufacturing_processes") or [])
        if isinstance(item, dict)
    ]


def _all_text(ai_raw: dict, filename: str = "") -> str:
    material = ai_raw.get("material") or {}
    pieces = [
        filename,
        ai_raw.get("drawing_no"),
        ai_raw.get("description"),
        ai_raw.get("drawing_type"),
        material.get("family") if isinstance(material, dict) else "",
        material.get("grade") if isinstance(material, dict) else "",
        material.get("specification") if isinstance(material, dict) else "",
        " ".join(str(x) for x in (ai_raw.get("notes") or [])),
        " ".join(str(x) for x in (ai_raw.get("surface_finish") or [])),
        " ".join(str(x.get("process") or "") for x in _process_entries(ai_raw)),
        " ".join(
            str(x.get("part_name") or x.get("description") or "")
            for x in (ai_raw.get("assembly_parts") or [])
            if isinstance(x, dict)
        ),
    ]
    return " ".join(str(x or "") for x in pieces)


def _document_type(ai_raw: dict, text_norm: str) -> str:
    explicit = str(ai_raw.get("document_type") or "").strip()
    if explicit in DOCUMENT_TYPES:
        return explicit

    raw = _norm(ai_raw.get("drawing_type"))
    assembly_parts = ai_raw.get("assembly_parts") or []
    welds = ai_raw.get("welds") or []

    if raw in {"ASSEMBLY", "GA", "GENERALARRANGEMENT"} or len(assembly_parts) > 1:
        return "Assembly Drawing"
    if "GENERALARRANGEMENT" in text_norm or re.search(r"\bGA\b", str(ai_raw.get("description") or ""), re.I):
        return "General Arrangement"
    if raw == "WELDMENT" or welds or any(x in text_norm for x in ("WELDMENT", "FABRICATIONDRAWING")):
        return "Weldment / Fabrication Drawing"
    if raw in {"PART", "MACHINING", "SHEETMETAL"}:
        return "Part Drawing"
    if "DETAILDRAWING" in text_norm:
        return "Detail Drawing"
    return "Part Drawing"


def _part_form(ai_raw: dict, text_norm: str, document_type: str) -> str:
    explicit = str(ai_raw.get("part_form") or "").strip()
    if explicit in PART_FORMS:
        return explicit

    if document_type in {"Assembly Drawing", "General Arrangement"}:
        return "Assembly"
    if any(x in text_norm for x in ("SHAFT", "BUSH", "BUSHING", "SPINDLE", "SLEEVE", "ROLLER", "PIN")):
        return "Shaft / Cylindrical"
    if "FLANGE" in text_norm:
        return "Flange"
    if any(x in text_norm for x in ("TUBE", "PIPE", "RHS", "SHS")):
        return "Tube / Pipe"
    if "BRACKET" in text_norm:
        return "Bracket"
    if any(x in text_norm for x in ("FRAME", "SKID", "STRUCTURE")):
        return "Frame"
    if any(x in text_norm for x in ("ENCLOSURE", "COVER", "PANEL", "CABINET")):
        return "Enclosure / Cover"
    if "GEAR" in text_norm:
        return "Gear"
    if any(x in text_norm for x in ("CASTING", "CASTPART", "ASCAST")):
        return "Casting"
    if any(x in text_norm for x in ("PLATE", "LASERCUTPLATE")):
        return "Plate"
    if any(x in text_norm for x in ("SHEETMETAL", "SHEET")):
        return "Sheet"
    if any(x in text_norm for x in ("BOLT", "NUT", "WASHER", "BEARING", "STANDARDPART", "PURCHASED")):
        return "Standard Part"
    if _norm(ai_raw.get("drawing_type")) == "MACHINING":
        return "Block / Prismatic"
    return "Unknown"


def _canonical_process(name: str) -> str | None:
    n = _norm(name)
    rules = [
        (("CAST", "FOUNDRY"), "Casting"),
        (("FORG",), "Forging"),
        (("EXTRUS",), "Extrusion"),
        (("LASER",), "Laser Cutting"),
        (("PRESSBRAKE", "BEND", "FORMING", "SHEETMETAL"), "Sheet-Metal Fabrication"),
        (("CNCTURN", "TURNING", "LATHE"), "CNC Turning"),
        (("CNCMILL", "MILLING"), "CNC Milling"),
        (("MACHIN",), "General Machining"),
        (("DRILL", "BORING", "BORE"), "Drilling / Boring"),
        (("THREAD", "TAPPING", "TAP"), "Threading / Tapping"),
        (("TIG", "MIG", "WELD", "FABRICAT"), "Welding / Fabrication"),
        (("PIPE", "TUBE"), "Tube / Pipe Fabrication"),
        (("GRIND", "POLISH", "DEBURR", "FINISH"), "Grinding / Finishing"),
        (("ADDITIVE", "3DPRINT", "PRINTING"), "Additive Manufacturing"),
        (("PURCHASE", "STANDARDPART", "BOUGHTOUT"), "Purchased / Standard Part"),
        (("ASSEMBLY", "INTEGRATION"), "Assembly / Integration"),
        (("INSPECT", "QC", "HANDLING"), "Inspection & Handling"),
    ]
    for keys, target in rules:
        if any(key in n for key in keys):
            return target
    return None


def _manufacturing_types(
    ai_raw: dict,
    text_norm: str,
    document_type: str,
    part_form: str,
) -> list[str]:
    explicit = [str(x).strip() for x in (ai_raw.get("manufacturing_types") or []) if str(x).strip()]
    detected: list[str] = []

    for value in explicit:
        canonical = _canonical_process(value) or value
        detected.append(canonical)

    for process in _process_entries(ai_raw):
        canonical = _canonical_process(str(process.get("process") or ""))
        if canonical:
            detected.append(canonical)

    if ai_raw.get("welds"):
        detected.append("Welding / Fabrication")
    if ai_raw.get("bends"):
        detected.append("Sheet-Metal Fabrication")
    if ai_raw.get("threads"):
        detected.append("Threading / Tapping")
    if ai_raw.get("holes"):
        detected.append("Drilling / Boring")

    if any(x in text_norm for x in ("CASTING", "ASCAST", "FOUNDRY")):
        detected.append("Casting")
    if "FORGING" in text_norm or "FORGED" in text_norm:
        detected.append("Forging")
    if "EXTRUSION" in text_norm or "EXTRUDED" in text_norm:
        detected.append("Extrusion")
    if any(x in text_norm for x in ("3DPRINT", "ADDITIVEMANUFACTUR")):
        detected.append("Additive Manufacturing")

    if part_form == "Shaft / Cylindrical" and not any(x in detected for x in ("CNC Turning", "Casting", "Forging")):
        detected.insert(0, "CNC Turning")
    elif part_form in {"Block / Prismatic", "Flange", "Gear"} and not any(
        x in detected for x in ("CNC Milling", "CNC Turning", "Casting", "Forging")
    ):
        detected.insert(0, "CNC Milling")
    elif part_form in {"Plate", "Sheet", "Bracket", "Enclosure / Cover"}:
        if ai_raw.get("bends"):
            detected.insert(0, "Sheet-Metal Fabrication")
        elif not any(x in detected for x in ("Laser Cutting", "Sheet-Metal Fabrication")):
            detected.insert(0, "Laser Cutting")
    elif part_form == "Tube / Pipe":
        detected.insert(0, "Tube / Pipe Fabrication")

    raw_type = _norm(ai_raw.get("drawing_type"))
    if raw_type == "MACHINING" and not any(
        x in detected for x in ("CNC Milling", "CNC Turning", "General Machining")
    ):
        detected.insert(0, "General Machining")

    if document_type in {"Assembly Drawing", "General Arrangement"}:
        detected.append("Assembly / Integration")

    if not detected:
        detected.append("Inspection & Handling")

    detected = _unique(detected)
    order = {name: index for index, name in enumerate(_PROCESS_PRIORITY)}
    return sorted(detected, key=lambda name: order.get(name, 999))


def _evidence(ai_raw: dict, document_type: str, part_form: str, manufacturing_types: list[str]) -> list[dict]:
    result: list[dict] = []

    for item in (ai_raw.get("evidence") or []):
        if not isinstance(item, dict):
            continue
        result.append({
            "field": str(item.get("field") or "Engineering evidence"),
            "value": str(item.get("value") or ""),
            "basis": str(item.get("basis") or item.get("quote") or item.get("source") or "Drawing evidence"),
            "page": max(0, int(item.get("page") or 0)),
            "confidence": _clamp(item.get("confidence") or 0),
        })

    confidence = ai_raw.get("confidence") or {}
    if not isinstance(confidence, dict):
        confidence = {}

    def add(field: str, value: str, basis: str, score: int):
        if not value:
            return
        key = (field.casefold(), value.casefold())
        if any((x["field"].casefold(), x["value"].casefold()) == key for x in result):
            return
        result.append({
            "field": field,
            "value": value,
            "basis": basis,
            "page": 0,
            "confidence": _clamp(score),
        })

    material = ai_raw.get("material") or {}
    material_value = " ".join(
        str(material.get(key) or "").strip()
        for key in ("family", "grade", "specification")
    ).strip() if isinstance(material, dict) else ""

    add("Document Type", document_type, f"drawing_type={ai_raw.get('drawing_type') or 'part'}; assembly/weld evidence evaluated", ai_raw.get("classification_confidence") or 80)
    add("Part Form", part_form, "Description, feature and process signals", ai_raw.get("classification_confidence") or 75)
    add("Manufacturing Route", " → ".join(manufacturing_types[:6]), "Extracted process/features and deterministic manufacturing rules", ai_raw.get("classification_confidence") or 75)
    add("Material", material_value, "Title block / material callout extraction", confidence.get("material", 0))
    if ai_raw.get("thickness_mm") is not None:
        add("Thickness", f"{ai_raw.get('thickness_mm')} mm", "Thickness callout", confidence.get("thickness", 0))
    add("Drawing No.", str(ai_raw.get("drawing_no") or ""), "Title block extraction", confidence.get("drawing_no", 0))
    add("Revision", str(ai_raw.get("revision") or ""), "Revision/title block extraction", confidence.get("revision", 0))

    return result[:30]


def _classification_confidence(ai_raw: dict, manufacturing_types: list[str], evidence: list[dict]) -> int:
    explicit = ai_raw.get("classification_confidence")
    if explicit not in (None, ""):
        return _clamp(explicit)

    process_scores = [
        _clamp(item.get("confidence"))
        for item in _process_entries(ai_raw)
        if item.get("confidence") is not None
    ]
    evidence_scores = [
        _clamp(item.get("confidence"))
        for item in evidence
        if item.get("confidence") not in (None, 0)
    ]
    values = process_scores + evidence_scores
    if values:
        return _clamp(sum(values) / len(values))
    return 60 if manufacturing_types else 30


def _completeness(ai_raw: dict, classification_confidence: int, rows: list[Any] | None = None) -> dict:
    confidence = ai_raw.get("confidence") or {}
    if not isinstance(confidence, dict):
        confidence = {}

    material = ai_raw.get("material") or {}
    material_ok = isinstance(material, dict) and any(str(material.get(k) or "").strip() for k in ("family", "grade", "specification"))
    dimensions = ai_raw.get("dimensions") or []
    processes = ai_raw.get("manufacturing_processes") or []
    uncertain = [str(x) for x in (ai_raw.get("missing_or_uncertain") or []) if str(x).strip()]

    weighted = [
        (bool(str(ai_raw.get("drawing_no") or "").strip()), 10),
        (material_ok, 15),
        (bool(dimensions), 15),
        (bool(processes), 15),
        (bool(ai_raw.get("product_quantity") or 0), 5),
        (classification_confidence >= 60, 10),
        (any(isinstance(x, dict) and str(x.get("tolerance") or "").strip() for x in dimensions), 10),
        (bool(ai_raw.get("holes") or ai_raw.get("threads") or ai_raw.get("bends") or ai_raw.get("welds") or ai_raw.get("chamfers")), 10),
        (bool(ai_raw.get("notes") or ai_raw.get("revision")), 10),
    ]
    engineering_score = sum(weight for passed, weight in weighted if passed)
    engineering_score = _clamp(engineering_score - min(20, len(uncertain) * 3))

    rate_coverage = 0
    row_confidence_scores: list[int] = []
    if rows:
        count = 0
        rated = 0
        for row in rows:
            category = str(getattr(row, "category", None) or (row.get("category") if isinstance(row, dict) else "")).upper()
            if category not in {"MATERIAL", "PROCESS", "LABOUR", "OTHER"}:
                continue
            count += 1
            rate = getattr(row, "rate", None) if not isinstance(row, dict) else row.get("rate")
            if float(rate or 0) > 0:
                rated += 1
            conf = getattr(row, "confidence", None) if not isinstance(row, dict) else row.get("confidence")
            row_confidence_scores.append({"Exact": 100, "Estimated": 72, "Assumed": 45}.get(str(conf), 50))
        if count:
            rate_coverage = round(rated * 100 / count)

    row_confidence = round(sum(row_confidence_scores) / len(row_confidence_scores)) if row_confidence_scores else 50
    extraction_scores = [
        _clamp(value)
        for value in confidence.values()
        if isinstance(value, (int, float)) and float(value) > 0
    ]
    extraction_confidence = round(sum(extraction_scores) / len(extraction_scores)) if extraction_scores else classification_confidence

    cost_confidence = _clamp(
        0.45 * rate_coverage
        + 0.35 * row_confidence
        + 0.20 * extraction_confidence
    ) if rows else _clamp(0.55 * extraction_confidence + 0.45 * classification_confidence)

    review_required = list(uncertain)
    if not material_ok:
        review_required.append("Material / grade is not confirmed.")
    if not dimensions:
        review_required.append("Critical dimensions are not confirmed.")
    if not processes:
        review_required.append("Manufacturing route requires confirmation.")
    if classification_confidence < 70:
        review_required.append("Drawing/manufacturing classification confidence is below 70%.")
    if rows and rate_coverage < 100:
        review_required.append("One or more costing rows do not have an approved Rate Master value.")

    review_required = _unique(review_required)
    release_state = "READY"
    if engineering_score < 55 or cost_confidence < 45:
        release_state = "ATTENTION"
    elif review_required or engineering_score < 80 or cost_confidence < 75:
        release_state = "REVIEW"

    return {
        "engineering_data": engineering_score,
        "cost_confidence": cost_confidence,
        "classification_confidence": classification_confidence,
        "rate_coverage": rate_coverage,
        "release_state": release_state,
        "review_required": review_required[:20],
    }


def build_cost_trace(rows: list[Any]) -> list[dict]:
    trace: list[dict] = []
    for row in rows or []:
        if isinstance(row, dict):
            get = row.get
        else:
            get = lambda key, default=None: getattr(row, key, default)

        qty = float(get("costingQty", 0) or 0)
        rate = float(get("rate", 0) or 0)
        amount = qty * rate
        unit = str(get("unit", "") or "")
        item = str(get("item", "") or "")
        category = str(get("category", "") or "")
        drawing_qty = str(get("drawingQty", "") or "")
        rate_source = str(get("rateSource", "") or "")
        confidence = str(get("confidence", "") or "")

        trace.append({
            "id": str(get("id", "") or ""),
            "category": category,
            "item": item,
            "drawing_basis": drawing_qty,
            "costing_qty": round(qty, 6),
            "unit": unit,
            "rate": round(rate, 6),
            "amount": round(amount, 2),
            "formula": f"{qty:g} {unit} × ₹{rate:g}/{unit or 'unit'} = ₹{amount:.2f}",
            "rate_source": rate_source,
            "confidence": confidence,
            "critical_score": _clamp(get("criticalScore", 0)),
        })
    return trace


def enrich_engineering_intelligence(
    ai_raw: dict | None,
    *,
    filename: str = "",
    source_format: str = "",
    rows: list[Any] | None = None,
) -> dict:
    data = dict(ai_raw or {})
    text_norm = _norm(_all_text(data, filename))

    document_type = _document_type(data, text_norm)
    part_form = _part_form(data, text_norm, document_type)
    manufacturing_types = _manufacturing_types(data, text_norm, document_type, part_form)
    evidence = _evidence(data, document_type, part_form, manufacturing_types)
    classification_confidence = _classification_confidence(data, manufacturing_types, evidence)
    completeness = _completeness(data, classification_confidence, rows)

    primary = str(data.get("primary_manufacturing_type") or "").strip()
    if not primary:
        primary = manufacturing_types[0] if manufacturing_types else "Inspection & Handling"

    process_route = [str(x).strip() for x in (data.get("process_route") or []) if str(x).strip()]
    if not process_route:
        process_route = manufacturing_types.copy()

    intelligence = {
        "document_type": document_type,
        "primary_manufacturing_type": primary,
        "manufacturing_types": manufacturing_types,
        "part_form": part_form,
        "classification_confidence": classification_confidence,
        "process_route": process_route,
        "evidence": evidence,
        "completeness": completeness,
        "source_format": source_format.upper() if source_format else "",
    }

    data["document_type"] = document_type
    data["primary_manufacturing_type"] = primary
    data["manufacturing_types"] = manufacturing_types
    data["part_form"] = part_form
    data["classification_confidence"] = classification_confidence
    data["process_route"] = process_route
    data["evidence"] = evidence
    data["engineering_intelligence"] = intelligence
    return data
