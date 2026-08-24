from __future__ import annotations
from app.extraction.pipeline import analyze_pdf_with_ai
from app.db import (
    append_extraction_record,
    append_review_record,
    database_stats,
    dataset_counts_fast,
    db_ping,
    init_database,
    latest_review_by_hash,
    load_store,
    save_store,
)

from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Literal
import base64
import json
import os
import math
import re
import uuid
import zipfile

import pymupdf as fitz

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from pydantic import BaseModel, Field
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

APP_DIR = Path(__file__).resolve().parent
LEGACY_DATA_DIR = APP_DIR.parent / "data"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


_HOT_CACHE: dict[str, object] = {}


def load(name: str, default):
    if name in {"rates", "settings"} and name in _HOT_CACHE:
        return _HOT_CACHE[name]

    value = load_store(name, default)

    if name in {"rates", "settings"}:
        _HOT_CACHE[name] = value

    return value


def save(name: str, data) -> None:
    save_store(name, data)

    if name in {"rates", "settings"}:
        _HOT_CACHE[name] = data

def defaults_settings():
    return {
        "company_name": "AI Manufacturing Quotation",
        "currency": "INR",
        "material_wastage_pct": 8.0,
        "overhead_pct": 12.0,
        "markup_pct": 15.0,
        "auto_dataset_capture": True,
        "learn_from_corrections": True,
        "training_batch_threshold": 25,
        "critical_medium_threshold": 40,
        "critical_high_threshold": 70,
    }


def _rate(
    rid: str,
    category: str,
    name: str,
    grade: str,
    unit: str,
    price: float,
    critical: int,
    notes: str,
):
    return {
        "id": rid,
        "category": category,
        "name": name,
        "grade": grade,
        "unit": unit,
        "price": price,
        "critical_score": critical,
        "active": True,
        "notes": notes,
        "updated_at": now(),
    }


def default_rate_items():
    # These are editable starter values, not live market prices.
    return [
        _rate("MAT-SS-201", "MATERIAL", "Stainless Steel", "AISI 201", "kg", 210, 88, "Starter rate - replace with supplier rate"),
        _rate("MAT-SS-202", "MATERIAL", "Stainless Steel", "AISI 202", "kg", 225, 88, "Starter rate - replace with supplier rate"),
        _rate("MAT-SS-304", "MATERIAL", "Stainless Steel", "AISI 304", "kg", 280, 92, "Starter rate - replace with supplier rate"),
        _rate("MAT-SS-304L", "MATERIAL", "Stainless Steel", "AISI 304L", "kg", 295, 92, "Starter rate - replace with supplier rate"),
        _rate("MAT-SS-316", "MATERIAL", "Stainless Steel", "AISI 316", "kg", 380, 94, "Starter rate - replace with supplier rate"),
        _rate("MAT-SS-316L", "MATERIAL", "Stainless Steel", "AISI 316L", "kg", 400, 95, "Starter rate - replace with supplier rate"),
        _rate("MAT-SS-321", "MATERIAL", "Stainless Steel", "AISI 321", "kg", 410, 93, "Starter rate - replace with supplier rate"),
        _rate("MAT-SS-430", "MATERIAL", "Stainless Steel", "AISI 430", "kg", 190, 85, "Starter rate - replace with supplier rate"),
        _rate("MAT-MS-E250", "MATERIAL", "Mild Steel", "IS 2062 E250", "kg", 70, 82, "Starter rate - replace with supplier rate"),
        _rate("MAT-MS-E350", "MATERIAL", "Mild Steel", "IS 2062 E350", "kg", 78, 82, "Starter rate - replace with supplier rate"),
        _rate("MAT-CS-A36", "MATERIAL", "Carbon Steel", "ASTM A36", "kg", 75, 80, "Starter rate - replace with supplier rate"),
        _rate("MAT-CS-S355J0", "MATERIAL", "Carbon / Structural Steel", "S355J0 / 1.0553", "kg", 85, 95, "Starter rate - edit in Rate Master"),

        _rate("MAT-AL-5052", "MATERIAL", "Aluminium", "5052-H32", "kg", 310, 88, "Starter rate - replace with supplier rate"),
        _rate("MAT-AL-6061", "MATERIAL", "Aluminium", "6061-T6", "kg", 340, 88, "Starter rate - replace with supplier rate"),
        _rate("MAT-AL-6082", "MATERIAL", "Aluminium", "6082-T6", "kg", 360, 88, "Starter rate - replace with supplier rate"),
        _rate("MAT-GI-DX51", "MATERIAL", "Galvanized Steel", "DX51D+Z", "kg", 95, 84, "Starter rate - replace with supplier rate"),
        _rate("MAT-CU-C110", "MATERIAL", "Copper", "C110", "kg", 780, 96, "Starter rate - replace with supplier rate"),
        _rate("MAT-BR-C260", "MATERIAL", "Brass", "C260", "kg", 520, 92, "Starter rate - replace with supplier rate"),
        _rate("PROC-LASER", "PROCESS", "Laser Cutting", "", "job", 450, 75, "Machine/setup rate"),
        _rate("PROC-BEND", "PROCESS", "Press Brake Forming", "", "job", 350, 70, "Bending/forming rate"),
        _rate("PROC-TIG", "PROCESS", "TIG Welding", "", "m", 250, 85, "Weld rate per metre"),
        _rate("PROC-MIG", "PROCESS", "MIG Welding", "", "m", 180, 80, "Weld rate per metre"),
        _rate("PROC-STUD", "PROCESS", "Stud Welding", "", "stud", 50, 65, "Rate per stud"),
        _rate("PROC-GRIND", "PROCESS", "Grinding & Flush", "", "job", 350, 70, "Finishing rate"),
        _rate("PROC-DEBURR", "PROCESS", "Deburring", "", "job", 150, 55, "Edge cleanup rate"),
        _rate("PROC-DRILL", "PROCESS", "Drilling", "", "hole", 15, 55, "Rate per hole"),
        _rate("PROC-POLISH", "PROCESS", "Polishing", "", "m2", 600, 75, "Surface finishing rate"),
        _rate("PROC-PASS", "PROCESS", "Passivation", "", "job", 500, 70, "Passivation allowance"),
        _rate("PROC-COAT", "PROCESS", "Powder Coating", "", "m2", 300, 75, "Coating rate"),
        _rate("PROC-QC", "PROCESS", "Inspection & Handling", "", "job", 150, 45, "Inspection allowance"),
        _rate("PROC-WELD", "PROCESS", "General / Tack Welding", "", "job", 300, 80, "Starter rate - edit in Rate Master"),
        _rate("PROC-SAW", "PROCESS", "Saw / Raw Stock Cutting", "", "job", 200, 70, "Starter rate - edit in Rate Master"),
        _rate("PROC-TURN", "PROCESS", "CNC Turning", "", "job", 650, 90, "Starter rate - edit in Rate Master"),
        _rate("PROC-BORE", "PROCESS", "Drilling / Boring", "", "job", 350, 85, "Starter rate - edit in Rate Master"),
        _rate("PROC-THREAD", "PROCESS", "Threading / Tapping", "", "job", 250, 90, "Starter rate - edit in Rate Master"),
        _rate("PROC-CHAMFER", "PROCESS", "Chamfering", "", "job", 120, 65, "Starter rate - edit in Rate Master"),
        _rate("PROC-MACHINE", "PROCESS", "General Machining", "", "job", 700, 90, "Starter rate - edit in Rate Master"),

        _rate("LAB-FAB", "LABOUR", "Fabricator", "", "hr", 350, 65, "Skilled fabricator labour"),
        _rate("LAB-TIG", "LABOUR", "TIG Welder", "", "hr", 450, 75, "TIG welder labour"),
        _rate("LAB-MIG", "LABOUR", "MIG Welder", "", "hr", 400, 70, "MIG welder labour"),
        _rate("LAB-FINISH", "LABOUR", "Finishing Operator", "", "hr", 300, 55, "Grinding/polishing labour"),
        _rate("LAB-QC", "LABOUR", "QC / Handling", "", "hr", 250, 45, "QC and handling labour"),
        _rate("LAB-MACH", "LABOUR", "Machinist", "", "hr", 500, 78, "Starter rate - edit in Rate Master"),
        _rate("LAB-MACHINE", "LABOUR", "Machine Operator", "", "hr", 350, 65, "Starter rate - edit in Rate Master"),
        _rate("LAB-WELD", "LABOUR", "Welder / Fabricator", "", "hr", 400, 75, "Starter rate - edit in Rate Master"),

        _rate("OTHER-PACK", "OTHER", "Packing", "", "job", 250, 40, "Packing allowance"),
        _rate("OTHER-CONS", "OTHER", "Welding Consumables", "", "job", 200, 60, "Consumables allowance"),
        _rate("COMM-WASTE", "COMMERCIAL", "Material Wastage", "", "%", 8, 60, "Applied to material cost"),
        _rate("COMM-OH", "COMMERCIAL", "Factory Overhead", "", "%", 12, 65, "Applied to direct cost + material wastage"),
        _rate("COMM-MARKUP", "COMMERCIAL", "Profit / Markup", "", "%", 15, 80, "Applied to manufacturing cost"),
    ]


def ensure_data():
    current_settings = load("settings", None)

    if not isinstance(current_settings, dict):
        save("settings", defaults_settings())
    else:
        merged_settings = {
            **defaults_settings(),
            **current_settings,
        }
        save("settings", merged_settings)

    existing_rates = load("rates", None)
    defaults = default_rate_items()

    if not isinstance(existing_rates, list):
        save("rates", defaults)
    else:
        existing_ids = {
            row.get("id")
            for row in existing_rates
            if isinstance(row, dict)
        }

        merged_rates = existing_rates + [
            row
            for row in defaults
            if row.get("id") not in existing_ids
        ]

        starter_by_id = {
            row["id"]: row
            for row in defaults
        }

        for row in merged_rates:
            default_row = starter_by_id.get(row.get("id"))

            if (
                default_row
                and float(row.get("price", 0) or 0) == 0
                and float(default_row.get("price", 0) or 0) > 0
                and str(row.get("notes", "")).upper().startswith(
                    "ENTER APPROVED"
                )
            ):
                row["price"] = default_row["price"]
                row["notes"] = "Starter rate - edit in Rate Master"
                row["updated_at"] = now()

        save("rates", merged_rates)

    for name, default in [
        ("extractions", []),
        ("reviews", []),
        ("quotations", []),
        ("revisions", []),
        (
            "dataset_meta",
            {
                "version": 1,
                "reviewed_at_version": 0,
            },
        ),
    ]:
        value = load(name, None)

        if value is None:
            save(name, default)


init_database(LEGACY_DATA_DIR)
ensure_data()

app = FastAPI(title="AI Manufacturing Quotation API", version="0.6.5")

_allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

_frontend_origin = os.getenv("FRONTEND_ORIGIN", "").strip().rstrip("/")
if _frontend_origin and _frontend_origin not in _allowed_origins:
    _allowed_origins.append(_frontend_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Drawing(BaseModel):
    drawing_no: str
    revision: str
    description: str
    material: str
    thickness_mm: float
    weight_kg: float
    quantity: int
    notes: list[str] = Field(default_factory=list)


class RateItem(BaseModel):
    id: str = ""
    category: Literal["MATERIAL", "PROCESS", "LABOUR", "OTHER", "COMMERCIAL"]
    name: str
    grade: str = ""
    unit: str
    price: float = Field(ge=0)
    critical_score: int = Field(default=50, ge=0, le=100)
    active: bool = True
    notes: str = ""
    updated_at: str = ""


class Row(BaseModel):
    id: str
    category: str
    item: str
    drawingQty: str
    costingQty: float
    unit: str
    rate: float
    cost: float
    confidence: Literal["Exact", "Estimated", "Assumed"]
    rateId: str | None = None
    rateSource: str = "Manual / Included"
    criticalScore: int = Field(default=50, ge=0, le=100)


class CostReq(BaseModel):
    rows: list[Row]


class RateSyncReq(BaseModel):
    row: Row
    material_family: str = ""
    material_grade: str = ""
    material_specification: str = ""


class Summary(BaseModel):
    direct_cost: float
    material_wastage: float
    overhead: float
    manufacturing_cost: float
    markup: float
    selling_price: float
    material_wastage_pct: float = 0
    overhead_pct: float = 0
    markup_pct: float = 0
    material_wastage_critical: int = 0
    overhead_critical: int = 0
    markup_critical: int = 0


class ReviewReq(BaseModel):
    extraction_id: str
    file_hash: str
    drawing: Drawing
    rows: list[Row]


class RevisionReq(BaseModel):
    drawing: Drawing
    note: str = "Snapshot"


class QuoteReq(BaseModel):
    customer: str
    drawing: Drawing
    summary: Summary
    rows: list[Row] = Field(default_factory=list)
    status: str = "Draft"


class ExportReq(BaseModel):
    drawing: Drawing
    rows: list[Row]
    summary: Summary


class PdfReq(ExportReq):
    customer: str = "Customer"


class BatchQuoteItem(BaseModel):
    drawing: Drawing
    rows: list[Row]
    summary: Summary


class BatchPdfReq(BaseModel):
    customer: str = "Customer"
    mode: Literal["separate", "merge"]
    items: list[BatchQuoteItem]


class BatchSaveReq(BaseModel):
    customer: str
    mode: Literal["separate", "merge"]
    items: list[BatchQuoteItem]
    status: str = "Draft"


class Settings(BaseModel):
    company_name: str
    currency: str
    material_wastage_pct: float
    overhead_pct: float
    markup_pct: float
    auto_dataset_capture: bool
    learn_from_corrections: bool
    training_batch_threshold: int
    critical_medium_threshold: int = 40
    critical_high_threshold: int = 70


def rates_list() -> list[dict]:
    rows = load("rates", default_rate_items())
    return rows if isinstance(rows, list) else default_rate_items()


def rate_by_id(rate_id: str | None) -> dict | None:
    if not rate_id:
        return None
    return next((r for r in rates_list() if r.get("id") == rate_id and r.get("active", True)), None)


def find_rate(category: str, name: str, grade: str = "") -> dict | None:
    candidates = [
        r
        for r in rates_list()
        if r.get("active", True)
        and r.get("category") == category
        and r.get("name", "").casefold() == name.casefold()
    ]
    if grade:
        exact = next(
            (r for r in candidates if r.get("grade", "").casefold() == grade.casefold()),
            None,
        )
        if exact:
            return exact
    return candidates[0] if candidates else None


def row_from_rate(
    row_id: str,
    category: str,
    item: str,
    drawing_qty: str,
    costing_qty: float,
    confidence: str,
    rate_id: str | None,
    fallback_unit: str,
    fallback_rate: float = 0,
    fallback_critical: int = 30,
    fallback_source: str = "Included / Manual",
) -> Row:
    saved = rate_by_id(rate_id)
    if saved:
        rate = float(saved.get("price", 0))
        unit = saved.get("unit", fallback_unit)
        critical = int(saved.get("critical_score", 50))
        source = "Rate Master"
    else:
        rate = fallback_rate
        unit = fallback_unit
        critical = fallback_critical
        source = fallback_source
    return Row(
        id=row_id,
        category=category,
        item=item,
        drawingQty=drawing_qty,
        costingQty=costing_qty,
        unit=unit,
        rate=rate,
        cost=costing_qty * rate,
        confidence=confidence,
        rateId=rate_id if saved else None,
        rateSource=source,
        criticalScore=critical,
    )


def calc(rows: list[Row]) -> Summary:
    settings = load("settings", defaults_settings())
    waste_rate = find_rate("COMMERCIAL", "Material Wastage")
    overhead_rate = find_rate("COMMERCIAL", "Factory Overhead")
    markup_rate = find_rate("COMMERCIAL", "Profit / Markup")

    waste_pct = float(waste_rate.get("price")) if waste_rate else float(settings["material_wastage_pct"])
    overhead_pct = float(overhead_rate.get("price")) if overhead_rate else float(settings["overhead_pct"])
    markup_pct = float(markup_rate.get("price")) if markup_rate else float(settings["markup_pct"])

    direct = sum(max(0, r.costingQty) * max(0, r.rate) for r in rows)
    material = sum(
        max(0, r.costingQty) * max(0, r.rate)
        for r in rows
        if r.category.upper() == "MATERIAL"
    )
    material_for_wastage = sum(
        max(0, r.costingQty) * max(0, r.rate)
        for r in rows
        if r.category.upper() == "MATERIAL"
        and r.id != "ai-material-stock"
    )
    wastage = material_for_wastage * waste_pct / 100
    overhead = (direct + wastage) * overhead_pct / 100
    manufacturing = direct + wastage + overhead
    markup = manufacturing * markup_pct / 100
    return Summary(
        direct_cost=round(direct, 2),
        material_wastage=round(wastage, 2),
        overhead=round(overhead, 2),
        manufacturing_cost=round(manufacturing, 2),
        markup=round(markup, 2),
        selling_price=round(manufacturing + markup, 2),
        material_wastage_pct=round(waste_pct, 2),
        overhead_pct=round(overhead_pct, 2),
        markup_pct=round(markup_pct, 2),
        material_wastage_critical=int(waste_rate.get("critical_score", 50)) if waste_rate else 50,
        overhead_critical=int(overhead_rate.get("critical_score", 50)) if overhead_rate else 50,
        markup_critical=int(markup_rate.get("critical_score", 50)) if markup_rate else 50,
    )



def clean_filename_description(filename: str) -> str:
    stem = Path(filename or "drawing").stem
    stem = re.sub(r"^\[?PID[#\s_-]*\d+\]?\s*", "", stem, flags=re.I)
    stem = re.sub(r"\s*-\s*R\d+(?:\.\d+)?(?:-\d{4}-\d{2}-\d{2})?\s*$", "", stem, flags=re.I)
    return re.sub(r"[_]+", " ", stem).strip() or "Engineering Drawing"


def extract_pdf_text(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
        chunks = []
        for page in reader.pages:
            try:
                chunks.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n".join(chunks)
    except Exception:
        return ""


def first_match(patterns: list[str], text: str, flags=re.I | re.M):
    for pattern in patterns:
        match = re.search(pattern, text, flags)
        if match:
            return match
    return None


def detect_material(text: str, filename: str):
    hay = f"{filename}\n{text}"

    ss = first_match(
        [
            r"\bAISI\s*(201|202|304L?|316L?|321|430)\b",
            r"\b(201|202|304L?|316L?|321|430)\s*SS\b",
            r"\bSS\s*(201|202|304L?|316L?|321|430)\b",
        ],
        hay,
    )
    if ss:
        grade = ss.group(1).upper()
        rate = find_rate("MATERIAL", "Stainless Steel", f"AISI {grade}")
        return f"AISI {grade} Stainless Steel", (rate or {}).get("id")

    ms = first_match([r"\b(?:IS\s*2062\s*)?(E250|E350)\b"], hay)
    if ms:
        grade = ms.group(1).upper()
        rate = find_rate("MATERIAL", "Mild Steel", f"IS 2062 {grade}")
        return f"Mild Steel IS 2062 {grade}", (rate or {}).get("id")

    if re.search(r"\b(?:MILD\s*STEEL|\bMS\b)", hay, re.I):
        return "Mild Steel", None

    al = first_match([r"\b(5052(?:-H32)?|6061(?:-T6)?|6082(?:-T6)?)\b"], hay)
    if al and re.search(r"\bAL(?:UMINIUM|UMINUM)?\b", hay, re.I):
        grade = al.group(1).upper()
        family = "Aluminium"
        grade_lookup = {
            "5052": "5052-H32", "5052-H32": "5052-H32",
            "6061": "6061-T6", "6061-T6": "6061-T6",
            "6082": "6082-T6", "6082-T6": "6082-T6",
        }.get(grade, grade)
        rate = find_rate("MATERIAL", family, grade_lookup)
        return f"{family} {grade_lookup}", (rate or {}).get("id")

    return "Not detected", None


def parse_float_match(match, group=1, default=0.0) -> float:
    if not match:
        return default
    try:
        return float(match.group(group).replace(",", "."))
    except Exception:
        return default


def extract_drawing_fields(content: bytes, filename: str):
    suffix = Path(filename or "").suffix.lower()
    warnings: list[str] = []
    raw_text = ""

    if suffix == ".pdf":
        raw_text = extract_pdf_text(content)
        source = "pdf_parser"
        if len(raw_text.strip()) < 20:
            warnings.append(
                "PDF text could not be read reliably. AI/Vision OCR is not connected yet; review all fields manually."
            )
    else:
        source = "file_specific_blank"
        warnings.append(
            f"{suffix or 'This file type'} needs the AI/CAD extraction module. "
            "The app intentionally does not reuse another drawing's data."
        )

    hay = f"{filename}\n{raw_text}"
    drawing_match = first_match(
        [
            r"\bPID\s*[#:\-]?\s*(\d{3,})\b",
            r"\[PID#(\d+)\]",
            r"\bDRAWING\s*(?:NO\.?|NUMBER)?\s*[:#\-]?\s*([A-Z0-9._/-]{3,})",
        ],
        hay,
    )
    drawing_no = drawing_match.group(1).strip() if drawing_match else ""
    if not drawing_no:
        file_pid = re.search(r"PID[#\s_-]*(\d+)", filename or "", re.I)
        drawing_no = file_pid.group(1) if file_pid else Path(filename or "drawing").stem[:60]

    rev_match = first_match(
        [
            r"\bREV(?:ISION)?\s*[:#\-]?\s*(R?\d+(?:\.\d+)?)\b",
            r"\b(R\d+(?:\.\d+)?)\b",
        ],
        hay,
    )
    revision = rev_match.group(1).upper() if rev_match else ""

    material, material_rate_id = detect_material(raw_text, filename)

    thickness_match = first_match(
        [
            r"\bTHICKNESS\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:MM)?\b",
            r"\b(\d+(?:[.,]\d+)?)\s*MM\s*(?:THK|THICK)\b",
            r"\b(\d+(?:[.,]\d+)?)\s*(?:THK|THICK)\b",
        ],
        hay,
    )
    thickness = parse_float_match(thickness_match)

    weight_match = first_match(
        [
            r"\bWEIGHT\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*KG\b",
            r"\b(\d+(?:[.,]\d+)?)\s*KG\s*(?:WEIGHT)?\b",
        ],
        hay,
    )
    weight = parse_float_match(weight_match)

    qty_match = first_match(
        [
            r"\bQTY(?:\.|UANTITY)?\s*[:=]?\s*(\d+)\b",
            r"\bQUANTITY\s*[:=]?\s*(\d+)\b",
        ],
        hay,
    )
    qty = int(qty_match.group(1)) if qty_match else 1

    description = clean_filename_description(filename)
    desc_match = first_match(
        [
            r"\bDESCRIPTION\s*[:=]\s*([^\n\r]{3,100})",
            r"\bTITLE\s*[:=]\s*([^\n\r]{3,100})",
        ],
        raw_text,
    )
    if desc_match:
        description = desc_match.group(1).strip()

    notes = []
    note_rules = [
        (r"FULLY\s*WELD(?:ED|ING)", "Fully welded fabrication"),
        (r"GRIND(?:ING)?\s*(?:AND|&)?\s*FLUSH", "Grind and flush welded edges"),
        (r"DEBURR", "Deburr all sharp edges"),
        (r"\bTIG\b", "TIG welding specified"),
        (r"\bMIG\b", "MIG welding specified"),
        (r"\bPASSIVAT", "Passivation specified"),
        (r"\bPOLISH", "Polishing specified"),
        (r"\bPOWDER\s*COAT", "Powder coating specified"),
    ]
    for pattern, label in note_rules:
        if re.search(pattern, hay, re.I):
            notes.append(label)

    hole_match = first_match(
        [
            r"(?:Ø|DIA(?:METER)?\.?)\s*(\d+(?:[.,]\d+)?)\s*(?:MM)?[^\n\r]{0,40}?\b(\d+)\s*(?:PLS|PLACES|NOS?)\b",
            r"\b(\d+)\s*(?:PLS|PLACES)\b[^\n\r]{0,40}?(?:Ø|DIA)",
        ],
        hay,
    )
    hole_count = 0
    hole_dia = 0.0
    if hole_match:
        try:
            if hole_match.lastindex and hole_match.lastindex >= 2:
                hole_dia = float(hole_match.group(1).replace(",", "."))
                hole_count = int(hole_match.group(2))
            else:
                hole_count = int(hole_match.group(1))
        except Exception:
            pass
    if hole_count:
        notes.append(
            f"Detected hole pattern: {hole_count} place(s)"
            + (f", Ø{hole_dia:g} mm" if hole_dia else "")
        )

    stud_match = first_match(
        [
            r"\b(\d+)\s*[X×]\s*[^\n\r]{0,30}?\bM(\d+)\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*MM\b",
            r"\b(\d+)\s*(?:STUDS?|PLS)[^\n\r]{0,30}?\bM(\d+)\b",
        ],
        hay,
    )
    stud_count = int(stud_match.group(1)) if stud_match else 0
    if stud_count:
        notes.append(f"Detected studs: {stud_count}")

    drawing = Drawing(
        drawing_no=drawing_no,
        revision=revision,
        description=description,
        material=material,
        thickness_mm=thickness,
        weight_kg=weight,
        quantity=max(1, qty),
        notes=notes,
    )

    rows: list[Row] = []

    if material != "Not detected":
        material_item = material.replace(" Stainless Steel", " SS")
        if weight > 0:
            rows.append(
                row_from_rate(
                    "mat",
                    "MATERIAL",
                    material_item,
                    f"{weight:g} kg net",
                    weight,
                    "Exact",
                    material_rate_id,
                    "kg",
                    fallback_critical=95,
                    fallback_source="Material detected; rate not found",
                )
            )
        else:
            rows.append(
                row_from_rate(
                    "mat",
                    "MATERIAL",
                    material_item,
                    "Weight not detected",
                    0,
                    "Estimated",
                    material_rate_id,
                    "kg",
                    fallback_critical=100,
                    fallback_source="Weight needs review",
                )
            )

    upper = hay.upper()

    if "LASER" in upper:
        rows.append(row_from_rate("laser", "PROCESS", "Laser Cutting", "Detected", 1, "Estimated", "PROC-LASER", "job"))

    if re.search(r"\bBEND(?:ING)?\b|\bPRESS\s*BRAKE\b|\bFORM(?:ING)?\b", upper):
        rows.append(row_from_rate("bend", "PROCESS", "Press Brake Forming", "Detected", 1, "Estimated", "PROC-BEND", "job"))

    if hole_count:
        drill_rate = rate_by_id("PROC-DRILL")
        rows.append(
            row_from_rate(
                "holes",
                "PROCESS",
                f"Drilling / holes" + (f" Ø{hole_dia:g} mm" if hole_dia else ""),
                f"{hole_count} holes",
                hole_count,
                "Exact",
                "PROC-DRILL" if drill_rate else None,
                "hole",
                0,
                60,
                "Hole count detected; verify manufacturing method",
            )
        )

    if "TIG" in upper:
        rows.append(row_from_rate("weld", "PROCESS", "TIG Welding", "Weld length not detected", 0, "Estimated", "PROC-TIG", "m", fallback_critical=100))
    elif "MIG" in upper:
        rows.append(row_from_rate("weld", "PROCESS", "MIG Welding", "Weld length not detected", 0, "Estimated", "PROC-MIG", "m", fallback_critical=100))
    elif "WELD" in upper:
        rows.append(
            row_from_rate(
                "weld",
                "PROCESS",
                "Welding — type/length review required",
                "Welding detected",
                0,
                "Estimated",
                None,
                "m",
                0,
                100,
                "Needs weld type + length",
            )
        )

    if stud_count:
        rows.append(row_from_rate("stud", "PROCESS", "Stud Welding", f"{stud_count} studs", stud_count, "Exact", "PROC-STUD", "stud"))

    if re.search(r"GRIND", upper):
        rows.append(row_from_rate("grind", "PROCESS", "Grinding & Flush", "Detected", 1, "Exact", "PROC-GRIND", "job"))

    if re.search(r"DEBURR", upper):
        rows.append(row_from_rate("deburr", "PROCESS", "Deburring", "Detected", 1, "Exact", "PROC-DEBURR", "job"))

    if re.search(r"POLISH", upper):
        rows.append(row_from_rate("polish", "PROCESS", "Polishing", "Area not detected", 0, "Estimated", "PROC-POLISH", "m2"))

    if re.search(r"PASSIVAT", upper):
        rows.append(row_from_rate("passivation", "PROCESS", "Passivation", "Detected", 1, "Estimated", "PROC-PASS", "job"))

    if re.search(r"POWDER\s*COAT", upper):
        rows.append(row_from_rate("coat", "PROCESS", "Powder Coating", "Area not detected", 0, "Estimated", "PROC-COAT", "m2"))

    # Labour is deliberately conservative: only add when a related process is detected.
    if any(r.category == "PROCESS" for r in rows):
        rows.append(row_from_rate("fab", "LABOUR", "Fabricator", "Estimated", 1, "Assumed", "LAB-FAB", "hr"))

    if any("TIG" in r.item for r in rows):
        rows.append(row_from_rate("tig-labour", "LABOUR", "TIG Welder", "Estimated", 1, "Assumed", "LAB-TIG", "hr"))
    elif any("MIG" in r.item for r in rows):
        rows.append(row_from_rate("mig-labour", "LABOUR", "MIG Welder", "Estimated", 1, "Assumed", "LAB-MIG", "hr"))

    if any(("Grinding" in r.item or "Deburring" in r.item or "Polishing" in r.item) for r in rows):
        rows.append(row_from_rate("finish-labour", "LABOUR", "Finishing Operator", "Estimated", 0.5, "Assumed", "LAB-FINISH", "hr"))

    if not raw_text.strip() and suffix == ".pdf":
        source = "pdf_text_unreadable"

    if not rows:
        warnings.append(
            "No reliable costing rows were detected. This is intentional: the system will not copy a previous drawing's values."
        )

    return drawing, rows, source, warnings, raw_text[:1500]


def ai_result_to_drawing(ai_data: dict) -> Drawing:
    """Convert Vision-AI JSON into the Drawing model used by the web app."""

    material_data = ai_data.get("material") or {}
    family = str(material_data.get("family") or "").strip()
    grade = str(material_data.get("grade") or "").strip()
    specification = str(material_data.get("specification") or "").strip()

    material_parts = []
    for value in [family, grade, specification]:
        if value and value.casefold() not in {x.casefold() for x in material_parts}:
            material_parts.append(value)

    material = " ".join(material_parts).strip() or "Not detected"

    notes: list[str] = []

    for note in ai_data.get("notes") or []:
        if note:
            notes.append(str(note).strip())

    for process in ai_data.get("manufacturing_processes") or []:
        if isinstance(process, dict):
            process_name = str(process.get("process") or "").strip()
            confidence = process.get("confidence")
            if process_name:
                suffix = f" ({confidence}% confidence)" if confidence is not None else ""
                notes.append(f"Process: {process_name}{suffix}")

    for item in ai_data.get("missing_or_uncertain") or []:
        if item:
            notes.append(f"Review required: {item}")

    # Preserve important engineering features in the current Review UI.
    # The frontend model does not yet have dedicated tables for these fields,
    # so they are shown as structured notes instead of being discarded.
    dimensions = ai_data.get("dimensions") or []
    for dim in dimensions:
        if not isinstance(dim, dict):
            continue
        value = dim.get("value_mm")
        label = str(dim.get("label") or dim.get("type") or "").strip()
        tolerance = str(dim.get("tolerance") or "").strip()
        qty = int(dim.get("quantity") or 1)
        if value is not None:
            detail = f"Dimension: {label + ' ' if label else ''}{value} mm"
            if tolerance:
                detail += f" ({tolerance})"
            if qty > 1:
                detail += f" × {qty}"
            notes.append(detail)

    threads = ai_data.get("threads") or []
    for thread in threads:
        if not isinstance(thread, dict):
            continue
        designation = str(thread.get("designation") or "").strip()
        qty = int(thread.get("quantity") or 0)
        through = bool(thread.get("through"))
        if designation:
            detail = f"Thread: {designation}"
            if qty:
                detail += f" × {qty}"
            if through:
                detail += " THRU"
            notes.append(detail)

    chamfers = ai_data.get("chamfers") or []
    for chamfer in chamfers:
        if not isinstance(chamfer, dict):
            continue
        size = chamfer.get("size_mm")
        angle = chamfer.get("angle_deg")
        qty = int(chamfer.get("quantity") or 0)
        if size is not None or angle is not None:
            detail = "Chamfer:"
            if size is not None:
                detail += f" {size} mm"
            if angle is not None:
                detail += f" × {angle}°"
            if qty:
                detail += f" ({qty} place(s))"
            notes.append(detail)

    bends = ai_data.get("bends") or []
    for bend in bends:
        if not isinstance(bend, dict):
            continue
        angle = bend.get("angle_deg")
        qty = int(bend.get("quantity") or 0)
        if angle is not None:
            notes.append(f"Bend: {angle}° × {qty or 1}")

    for finish in ai_data.get("surface_finish") or []:
        if finish:
            notes.append(f"Surface finish: {finish}")

    holes = ai_data.get("holes") or []
    for hole in holes:
        if not isinstance(hole, dict):
            continue
        qty = int(hole.get("quantity") or 0)
        dia = hole.get("diameter_mm")
        hole_type = str(hole.get("type") or "").strip()
        if qty:
            detail = f"Holes: {qty}"
            if dia is not None:
                detail += f" × Ø{dia} mm"
            if hole_type:
                detail += f" {hole_type}"
            notes.append(detail)

    studs = ai_data.get("studs") or []
    for stud in studs:
        if not isinstance(stud, dict):
            continue
        qty = int(stud.get("quantity") or 0)
        size = str(stud.get("size") or "").strip()
        length = stud.get("length_mm")
        if qty:
            detail = f"Studs: {qty}"
            if size:
                detail += f" × {size}"
            if length is not None:
                detail += f" × {length} mm"
            notes.append(detail)

    welds = ai_data.get("welds") or []
    for weld in welds:
        if not isinstance(weld, dict):
            continue
        weld_type = str(weld.get("type") or "").strip()
        length = weld.get("length_mm")
        location = str(weld.get("location") or "").strip()
        if weld_type or length is not None or location:
            detail = "Weld"
            if weld_type:
                detail += f": {weld_type}"
            if length is not None:
                detail += f", {length} mm"
            if location:
                detail += f", {location}"
            notes.append(detail)

    def safe_float(value, default=0.0):
        try:
            return float(value) if value is not None else default
        except (TypeError, ValueError):
            return default

    def safe_int(value, default=1):
        try:
            parsed = int(value) if value is not None else default
            return max(1, parsed)
        except (TypeError, ValueError):
            return default

    return Drawing(
        drawing_no=str(ai_data.get("drawing_no") or "").strip(),
        revision=str(ai_data.get("revision") or "").strip(),
        description=str(ai_data.get("description") or "Engineering Drawing").strip(),
        material=material,
        thickness_mm=safe_float(ai_data.get("thickness_mm")),
        weight_kg=safe_float(ai_data.get("weight_kg")),
        quantity=safe_int(ai_data.get("product_quantity"), 1),
        notes=notes,
    )


def _norm(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())


def find_material_rate_from_ai(ai_data: dict) -> dict | None:
    """Match AI material family/grade/specification to an active MATERIAL rate."""
    material = ai_data.get("material") or {}
    family = str(material.get("family") or "")
    grade = str(material.get("grade") or "")
    spec = str(material.get("specification") or "")

    combined = _norm(f"{family} {grade} {spec}")

    # Strong known-grade aliases first.
    aliases = {
        "S355J0": "MAT-CS-S355J0",
        "10553": "MAT-CS-S355J0",
        "AISI304": "MAT-SS-304",
        "304SS": "MAT-SS-304",
        "AISI304L": "MAT-SS-304L",
        "AISI316": "MAT-SS-316",
        "AISI316L": "MAT-SS-316L",
        "AISI430": "MAT-SS-430",
        "IS2062E250": "MAT-MS-E250",
        "IS2062E350": "MAT-MS-E350",
        "ASTMA36": "MAT-CS-A36",
        "6061T6": "MAT-AL-6061",
        "6082T6": "MAT-AL-6082",
        "5052H32": "MAT-AL-5052",
    }

    for alias, rate_id in aliases.items():
        if alias in combined:
            found = rate_by_id(rate_id)
            if found:
                return found

    # Generic grade/name comparison.
    for rate in rates_list():
        if rate.get("category") != "MATERIAL" or not rate.get("active", True):
            continue
        rate_grade = _norm(rate.get("grade", ""))
        rate_name = _norm(rate.get("name", ""))
        if rate_grade and (rate_grade in combined or combined in rate_grade):
            return rate
        if rate_name and rate_name in combined and not grade:
            return rate

    return None


def ai_confidence_label(score) -> Literal["Exact", "Estimated", "Assumed"]:
    try:
        value = float(score)
    except (TypeError, ValueError):
        value = 50.0

    if value >= 85:
        return "Exact"
    if value >= 60:
        return "Estimated"
    return "Assumed"


def process_rate_id(process_name: str) -> str | None:
    """Map AI process wording to Rate Master IDs."""
    name = _norm(process_name)

    rules = [
        (("LASER",), "PROC-LASER"),
        (("PRESSBRAKE", "BEND", "FORMING"), "PROC-BEND"),
        (("TIG",), "PROC-TIG"),
        (("MIG",), "PROC-MIG"),
        (("STUDWELD",), "PROC-STUD"),
        (("TACKWELD", "TACKWELDING", "GENERALWELD", "WELDING", "WELD"), "PROC-WELD"),
        (("GRIND",), "PROC-GRIND"),
        (("DEBURR",), "PROC-DEBURR"),
        (("PASSIV",), "PROC-PASS"),
        (("POLISH",), "PROC-POLISH"),
        (("POWDERCOAT",), "PROC-COAT"),
        (("INSPECT", "QC"), "PROC-QC"),
        (("SAW", "RAWCUT", "STOCKCUT"), "PROC-SAW"),
        (("CNCTURN", "TURNING", "LATHE"), "PROC-TURN"),
        (("BORING", "BORE"), "PROC-BORE"),
        (("DRILL",), "PROC-BORE"),
        (("THREAD", "TAPPING", "TAP"), "PROC-THREAD"),
        (("CHAMFER",), "PROC-CHAMFER"),
        (("MACHINING", "MACHINE"), "PROC-MACHINE"),
    ]

    for keys, rate_id in rules:
        if any(key in name for key in keys):
            return rate_id
    return None



# Internal stock assumptions used only for costing.
# They are not displayed in the application UI.
#
# Where we have a useful flat-sheet stock catalog, the engine chooses the
# smallest economical purchasable format. For other material families it uses
# the exact required blank rather than inventing an unknown supplier size.
_INTERNAL_STOCK_SIZES_MM = {
    "STAINLESS": [
        (500.0, 500.0),
        (1000.0, 2000.0),
        (1250.0, 2500.0),
        (1500.0, 3000.0),
        (2000.0, 4000.0),
    ],
    "ALUMINIUM": [
        (500.0, 500.0),
        (1000.0, 2000.0),
        (1250.0, 2500.0),
        (1500.0, 3000.0),
        (1525.0, 3660.0),
        (2000.0, 4000.0),
        (2000.0, 6000.0),
    ],
    "ALUMINUM": [
        (500.0, 500.0),
        (1000.0, 2000.0),
        (1250.0, 2500.0),
        (1500.0, 3000.0),
        (1525.0, 3660.0),
        (2000.0, 4000.0),
        (2000.0, 6000.0),
    ],
    "COPPER": [
        (500.0, 500.0),
        (600.0, 1220.0),
        (1000.0, 2000.0),
        (1220.0, 2440.0),
        (1250.0, 2500.0),
        (1500.0, 3000.0),
        (2000.0, 4000.0),
    ],
}

_INTERNAL_DENSITY_KG_PER_MM3 = {
    "STAINLESS": 7.93e-6,
    "MILDSTEEL": 7.85e-6,
    "CARBONSTEEL": 7.85e-6,
    "STRUCTURALSTEEL": 7.85e-6,
    "GALVANIZEDSTEEL": 7.85e-6,
    "ALUMINIUM": 2.70e-6,
    "ALUMINUM": 2.70e-6,
    "COPPER": 8.96e-6,
    "BRASS": 8.50e-6,
}


def _internal_material_key(ai_data: dict, drawing: Drawing) -> str:
    material = ai_data.get("material") or {}
    return _norm(
        f"{material.get('family', '')} "
        f"{material.get('grade', '')} "
        f"{material.get('specification', '')} "
        f"{drawing.material}"
    )


def _internal_density(ai_data: dict, drawing: Drawing) -> float:
    key = _internal_material_key(ai_data, drawing)
    for family, density in _INTERNAL_DENSITY_KG_PER_MM3.items():
        if family in key:
            return density
    return 7.85e-6


def _internal_stock_catalog(ai_data: dict, drawing: Drawing) -> list[tuple[float, float]]:
    key = _internal_material_key(ai_data, drawing)
    for family, sizes in _INTERNAL_STOCK_SIZES_MM.items():
        if family in key:
            return sizes
    return []


def _is_sheet_based_part(ai_data: dict, drawing: Drawing) -> bool:
    try:
        thickness = float(ai_data.get("thickness_mm") or drawing.thickness_mm or 0)
    except (TypeError, ValueError):
        thickness = 0

    if thickness <= 0:
        return False

    processes = " ".join(
        str(x.get("process") or "")
        for x in (ai_data.get("manufacturing_processes") or [])
        if isinstance(x, dict)
    )

    combined = _norm(
        f"{drawing.description} {drawing.material} "
        f"{processes} {' '.join(str(x) for x in (ai_data.get('notes') or []))}"
    )

    if any(
        signal in combined
        for signal in [
            "SHEET", "PLATE", "LASER", "PRESSBRAKE", "BEND",
            "FORMING", "STRUT", "TRAY", "PANEL", "BRACKET", "COVER"
        ]
    ):
        return True

    usable_dims = []
    for dim in ai_data.get("dimensions") or []:
        if not isinstance(dim, dict):
            continue
        try:
            value = float(dim.get("value_mm") or 0)
        except (TypeError, ValueError):
            continue
        if value > max(20.0, thickness * 3):
            usable_dims.append(value)

    return len(usable_dims) >= 2


def _internal_part_length_width(
    ai_data: dict,
    drawing: Drawing,
) -> tuple[float, float] | None:
    try:
        thickness = float(ai_data.get("thickness_mm") or drawing.thickness_mm or 0)
    except (TypeError, ValueError):
        thickness = 0

    dimension_rows: list[tuple[float, str]] = []

    for dim in ai_data.get("dimensions") or []:
        if not isinstance(dim, dict):
            continue

        try:
            value = float(dim.get("value_mm") or 0)
        except (TypeError, ValueError):
            continue

        if value <= max(20.0, thickness * 3):
            continue

        label = str(dim.get("label") or dim.get("type") or "").strip()
        dimension_rows.append((value, label))

    if not dimension_rows:
        return None

    preferred = [
        (value, label)
        for value, label in dimension_rows
        if any(
            key in _norm(label)
            for key in ["OVERALL", "LENGTH", "WIDTH", "HEIGHT", "OAL"]
        )
    ]

    source_rows = preferred if len(preferred) >= 2 else dimension_rows
    values = sorted(
        {round(value, 3) for value, _ in source_rows if value > 0},
        reverse=True,
    )

    if not values:
        return None

    length = values[0]
    width = values[1] if len(values) > 1 else values[0]
    return max(1.0, length), max(1.0, width)


def _internal_sheet_material_quantity_kg(
    ai_data: dict,
    drawing: Drawing,
) -> float | None:
    if not _is_sheet_based_part(ai_data, drawing):
        return None

    try:
        thickness = float(ai_data.get("thickness_mm") or drawing.thickness_mm or 0)
    except (TypeError, ValueError):
        return None

    if thickness <= 0:
        return None

    size = _internal_part_length_width(ai_data, drawing)
    if not size:
        return None

    part_length, part_width = size
    product_qty = max(1, int(drawing.quantity or 1))
    density = _internal_density(ai_data, drawing)
    stock_catalog = _internal_stock_catalog(ai_data, drawing)

    # Unknown family: use exactly what is required.
    if not stock_catalog:
        total_area = part_length * part_width * product_qty
        return round(total_area * thickness * density, 4)

    candidates: list[tuple[float, float, float, int]] = []

    for stock_length, stock_width in stock_catalog:
        normal_fit = (
            math.floor(stock_length / part_length)
            * math.floor(stock_width / part_width)
            if part_length <= stock_length and part_width <= stock_width
            else 0
        )

        rotated_fit = (
            math.floor(stock_length / part_width)
            * math.floor(stock_width / part_length)
            if part_width <= stock_length and part_length <= stock_width
            else 0
        )

        fit = max(normal_fit, rotated_fit)
        if fit <= 0:
            continue

        purchase_count = max(1, math.ceil(product_qty / fit))
        total_area = stock_length * stock_width * purchase_count

        candidates.append(
            (total_area, stock_length, stock_width, purchase_count)
        )

    # Larger than known formats: use exactly what is required.
    if not candidates:
        total_area = part_length * part_width * product_qty
        return round(total_area * thickness * density, 4)

    total_area, _, _, _ = min(candidates, key=lambda item: item[0])
    return round(total_area * thickness * density, 4)

def _add_labour_rows(rows: list[Row]) -> None:
    process_ids = {
        row.rateId
        for row in rows
        if row.category == "PROCESS" and row.rateId
    }

    labour_added: set[str] = set()

    def add_labour(
        row_id: str,
        rate_id: str,
        item: str,
        hours: float,
        description: str,
    ):
        if rate_id in labour_added:
            return
        labour_added.add(rate_id)

        rows.append(
            row_from_rate(
                row_id,
                "LABOUR",
                item,
                description,
                hours,
                "Estimated",
                rate_id,
                "hr",
                fallback_critical=70,
            )
        )

    fabrication_ids = {"PROC-LASER", "PROC-BEND", "PROC-STUD", "PROC-SAW"}
    machining_ids = {"PROC-TURN", "PROC-BORE", "PROC-THREAD", "PROC-CHAMFER", "PROC-MACHINE"}
    finishing_ids = {"PROC-GRIND", "PROC-DEBURR", "PROC-POLISH", "PROC-PASS", "PROC-COAT"}

    if process_ids & fabrication_ids:
        add_labour(
            "lab-fabricator",
            "LAB-FAB",
            "Fabricator",
            1.0,
            "Default fabrication labour allowance",
        )

    if process_ids & {"PROC-LASER", "PROC-SAW"}:
        add_labour(
            "lab-machine-operator",
            "LAB-MACHINE",
            "Machine Operator",
            0.75,
            "Default machine-operation labour allowance",
        )

    if process_ids & machining_ids:
        machining_count = len(process_ids & machining_ids)
        add_labour(
            "lab-machinist",
            "LAB-MACH",
            "Machinist",
            max(1.0, round(machining_count * 0.75, 2)),
            "Default machining labour allowance",
        )

    if "PROC-TIG" in process_ids:
        add_labour(
            "lab-tig",
            "LAB-TIG",
            "TIG Welder",
            1.0,
            "Default welding labour allowance",
        )
    elif "PROC-MIG" in process_ids:
        add_labour(
            "lab-mig",
            "LAB-MIG",
            "MIG Welder",
            1.0,
            "Default welding labour allowance",
        )
    elif "PROC-WELD" in process_ids:
        add_labour(
            "lab-welder",
            "LAB-WELD",
            "Welder / Fabricator",
            1.0,
            "Default welding labour allowance",
        )

    if process_ids & finishing_ids:
        add_labour(
            "lab-finishing",
            "LAB-FINISH",
            "Finishing Operator",
            0.75,
            "Default finishing labour allowance",
        )

    if process_ids:
        add_labour(
            "lab-qc",
            "LAB-QC",
            "QC / Handling",
            0.5,
            "Default inspection/handling labour allowance",
        )

def ai_result_to_rows(ai_data: dict, drawing: Drawing) -> list[Row]:
    """
    Convert Vision AI extraction into editable costing rows.
    Quantities come from the drawing/AI. Prices come ONLY from Rate Master.
    Missing rates are shown as 0 with Critical Score 100, rather than silently
    generating a fake quotation.
    """
    rows: list[Row] = []
    seen: set[str] = set()

    material_rate = find_material_rate_from_ai(ai_data)
    material_name = drawing.material or "Material"

    material_conf = (ai_data.get("confidence") or {}).get("material", 0)
    weight_conf = (ai_data.get("confidence") or {}).get("weight", 0)
    material_row_conf = ai_confidence_label(min(
        float(material_conf or 0),
        float(weight_conf or material_conf or 0),
    ))

    if drawing.material != "Not detected":
        internal_material_qty = _internal_sheet_material_quantity_kg(
            ai_data,
            drawing,
        )

        rate_id = material_rate.get("id") if material_rate else None
        fallback_source = (
            "Rate Master"
            if material_rate
            else "RATE MISSING - edit rate in this sheet"
        )

        costing_qty = (
            internal_material_qty
            if internal_material_qty is not None
            else (drawing.weight_kg if drawing.weight_kg > 0 else 0)
        )

        rows.append(
            row_from_rate(
                "ai-material-stock" if internal_material_qty is not None else "ai-material",
                "MATERIAL",
                material_name,
                f"{max(1, drawing.quantity)} part(s)",
                costing_qty,
                material_row_conf,
                rate_id,
                "kg",
                fallback_rate=0,
                fallback_critical=100 if not material_rate else int(material_rate.get("critical_score", 95)),
                fallback_source=fallback_source,
            )
        )

    # Manufacturing processes extracted by Vision.
    for index, process in enumerate(ai_data.get("manufacturing_processes") or [], start=1):
        if not isinstance(process, dict):
            continue

        name = str(process.get("process") or "").strip()
        if not name:
            continue

        rate_id = process_rate_id(name)
        saved_rate = rate_by_id(rate_id) if rate_id else None

        # Avoid duplicate semantic process rows.
        semantic_key = rate_id or _norm(name)
        if semantic_key in seen:
            continue
        seen.add(semantic_key)

        confidence = ai_confidence_label(process.get("confidence"))
        reason = str(process.get("reason") or "").strip()

        rows.append(
            row_from_rate(
                f"ai-process-{index}",
                "PROCESS",
                saved_rate.get("name") if saved_rate else name,
                reason or "Detected by Vision AI",
                1,
                confidence,
                rate_id if saved_rate else None,
                saved_rate.get("unit", "job") if saved_rate else "job",
                fallback_rate=0,
                fallback_critical=100 if not saved_rate else int(saved_rate.get("critical_score", 80)),
                fallback_source="RATE MISSING - add process rate in Rate Master" if not saved_rate else "Rate Master",
            )
        )

    # Hole features: for ordinary holes use drilling/boring quantity.
    holes = ai_data.get("holes") or []
    total_plain_holes = 0
    total_threaded_holes = 0
    hole_confidences = []

    for hole in holes:
        if not isinstance(hole, dict):
            continue
        qty = int(hole.get("quantity") or 0)
        if qty <= 0:
            continue
        hole_type = str(hole.get("type") or "")
        hole_confidences.append(hole.get("confidence"))
        if any(word in hole_type.casefold() for word in ["thread", "tap", "m16", "m12", "m10", "m8", "m6", "m5", "m4", "m3"]):
            total_threaded_holes += qty
        else:
            total_plain_holes += qty

    if total_plain_holes and "PROC-BORE" not in seen:
        seen.add("PROC-BORE")
        rows.append(
            row_from_rate(
                "ai-holes",
                "PROCESS",
                "Drilling / Boring",
                f"{total_plain_holes} hole(s)",
                1,
                ai_confidence_label(max([x or 0 for x in hole_confidences], default=70)),
                "PROC-BORE",
                "job",
                fallback_critical=85,
            )
        )

    if total_threaded_holes and "PROC-THREAD" not in seen:
        seen.add("PROC-THREAD")
        rows.append(
            row_from_rate(
                "ai-thread",
                "PROCESS",
                "Threading / Tapping",
                f"{total_threaded_holes} threaded hole(s)",
                1,
                ai_confidence_label(max([x or 0 for x in hole_confidences], default=70)),
                "PROC-THREAD",
                "job",
                fallback_critical=90,
            )
        )

    # Feature-driven processing rows, in case the AI did not explicitly list them.
    bends = ai_data.get("bends") or []
    bend_qty = sum(
        max(1, int(bend.get("quantity") or 1))
        for bend in bends
        if isinstance(bend, dict)
    )
    if bend_qty and "PROC-BEND" not in seen:
        seen.add("PROC-BEND")
        rows.append(
            row_from_rate(
                "ai-bends",
                "PROCESS",
                "Press Brake Forming",
                f"{bend_qty} bend(s)",
                1,
                "Estimated",
                "PROC-BEND",
                "job",
            )
        )

    chamfers = ai_data.get("chamfers") or []
    chamfer_qty = sum(
        max(1, int(chamfer.get("quantity") or 1))
        for chamfer in chamfers
        if isinstance(chamfer, dict)
    )
    if chamfer_qty and "PROC-CHAMFER" not in seen:
        seen.add("PROC-CHAMFER")
        rows.append(
            row_from_rate(
                "ai-chamfers",
                "PROCESS",
                "Chamfering",
                f"{chamfer_qty} chamfer location(s)",
                1,
                "Estimated",
                "PROC-CHAMFER",
                "job",
            )
        )

    # Stud welding features.
    studs = ai_data.get("studs") or []
    stud_qty = sum(
        int(stud.get("quantity") or 0)
        for stud in studs
        if isinstance(stud, dict)
    )
    if stud_qty and "PROC-STUD" not in seen:
        seen.add("PROC-STUD")
        rows.append(
            row_from_rate(
                "ai-studs",
                "PROCESS",
                "Stud Welding",
                f"{stud_qty} stud(s)",
                stud_qty,
                "Exact",
                "PROC-STUD",
                "stud",
            )
        )

    # Weld length only if AI provides an actual length.
    welds = ai_data.get("welds") or []
    total_weld_mm = 0.0
    weld_type = ""
    weld_score = 0
    for weld in welds:
        if not isinstance(weld, dict):
            continue
        try:
            total_weld_mm += float(weld.get("length_mm") or 0)
        except (TypeError, ValueError):
            pass
        weld_type = weld_type or str(weld.get("type") or "")
        try:
            weld_score = max(weld_score, int(weld.get("confidence") or 0))
        except (TypeError, ValueError):
            pass

    if total_weld_mm > 0:
        weld_rate_id = "PROC-TIG" if "TIG" in weld_type.upper() else (
            "PROC-MIG" if "MIG" in weld_type.upper() else None
        )
        rows.append(
            row_from_rate(
                "ai-weld",
                "PROCESS",
                f"{weld_type or 'Welding'}",
                f"{total_weld_mm:g} mm",
                total_weld_mm / 1000.0,
                ai_confidence_label(weld_score),
                weld_rate_id,
                "m",
                fallback_rate=0,
                fallback_critical=100,
                fallback_source="RATE / WELD TYPE REVIEW REQUIRED",
            )
        )
    elif welds and not ({"PROC-TIG", "PROC-MIG", "PROC-WELD"} & seen):
        seen.add("PROC-WELD")
        rows.append(
            row_from_rate(
                "ai-weld-job",
                "PROCESS",
                "General / Tack Welding",
                f"{len(welds)} weld callout(s)",
                1,
                "Estimated",
                "PROC-WELD",
                "job",
            )
        )

    _add_labour_rows(rows)

    return rows


def make_drawing_preview(content: bytes, filename: str) -> str:
    """
    Return a compact first-page snapshot as a data URL for the Review screen.
    This is display-only and separate from the high-resolution images used by AI.
    """
    suffix = Path(filename or "").suffix.lower()

    try:
        if suffix == ".pdf":
            doc = fitz.open(stream=content, filetype="pdf")
            if doc.page_count == 0:
                doc.close()
                return ""

            page = doc[0]

            # About 120 DPI: clear enough for a preview without sending a huge JSON response.
            matrix = fitz.Matrix(120 / 72, 120 / 72)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            data = pix.tobytes("jpeg", jpg_quality=72)
            doc.close()

            encoded = base64.b64encode(data).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}"

        mime_by_suffix = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }

        mime = mime_by_suffix.get(suffix)
        if mime:
            encoded = base64.b64encode(content).decode("ascii")
            return f"data:{mime};base64,{encoded}"

    except Exception:
        return ""

    return ""

def reviewed_memory(file_hash: str):
    if not load("settings", defaults_settings())["learn_from_corrections"]:
        return None
    return latest_review_by_hash(file_hash)


@app.get("/api/health")
def health():
    connected = db_ping()

    return {
        "status": "ok" if connected else "degraded",
        "version": "0.6.5",
        "database": "connected" if connected else "unavailable",
    }


@app.get("/api/database/stats")
def get_database_stats():
    if not db_ping():
        raise HTTPException(
            status_code=503,
            detail="PostgreSQL database is unavailable.",
        )

    return database_stats()


@app.get("/api/settings")
def get_settings():
    return load("settings", defaults_settings())


@app.put("/api/settings")
def put_settings(value: Settings):
    save("settings", value.model_dump())
    return value


@app.get("/api/rates", response_model=list[RateItem])
def get_rates():
    return rates_list()


@app.get("/api/rate-catalog")
def rate_catalog():
    materials: dict[str, list[str]] = {}
    for row in rates_list():
        if row.get("category") == "MATERIAL":
            materials.setdefault(row.get("name", "Material"), [])
            grade = row.get("grade", "")
            if grade and grade not in materials[row.get("name", "Material")]:
                materials[row.get("name", "Material")].append(grade)
    return {
        "materials": materials,
        "processes": [
            "Laser Cutting",
            "Press Brake Forming",
            "TIG Welding",
            "MIG Welding",
            "Stud Welding",
            "Grinding & Flush",
            "Deburring",
            "Drilling",
            "Polishing",
            "Passivation",
            "Powder Coating",
            "Inspection & Handling",
        ],
        "labour": [
            "Fabricator",
            "TIG Welder",
            "MIG Welder",
            "Finishing Operator",
            "QC / Handling",
        ],
        "commercial": ["Material Wastage", "Factory Overhead", "Profit / Markup"],
        "units": ["kg", "job", "m", "m2", "stud", "hole", "hr", "each", "%"],
    }


def _normalized_rate_category(value: str) -> str:
    key = _norm(value)
    return {
        "MATERIAL": "MATERIAL",
        "MATERIALS": "MATERIAL",
        "PROCESS": "PROCESS",
        "PROCESSING": "PROCESS",
        "OPERATION": "PROCESS",
        "LABOUR": "LABOUR",
        "LABOR": "LABOUR",
        "OTHER": "OTHER",
        "COMMERCIAL": "COMMERCIAL",
    }.get(key, "OTHER")


def _default_rate_critical(category: str) -> int:
    return {
        "MATERIAL": 85,
        "PROCESS": 70,
        "LABOUR": 65,
        "COMMERCIAL": 75,
        "OTHER": 50,
    }.get(category, 50)


def _find_rate_for_sync(
    category: str,
    name: str,
    grade: str,
) -> dict | None:
    for rate in rates_list():
        if not rate.get("active", True):
            continue
        if rate.get("category") != category:
            continue
        if str(rate.get("name", "")).casefold().strip() != name.casefold().strip():
            continue

        if category == "MATERIAL":
            saved_grade = str(rate.get("grade", "")).casefold().strip()
            if saved_grade != grade.casefold().strip():
                continue

        return rate

    return None


@app.post("/api/rates/sync-row")
def sync_rate_from_cost_sheet(value: RateSyncReq):
    row = value.row
    category = _normalized_rate_category(row.category)

    if category == "MATERIAL":
        name = value.material_family.strip() or row.item.strip() or "Material"
        grade = " / ".join(
            part
            for part in [
                value.material_grade.strip(),
                value.material_specification.strip(),
            ]
            if part
        )
    else:
        name = row.item.strip() or "Unnamed Cost Item"
        grade = ""

    existing = None

    if row.rateId:
        candidate = rate_by_id(row.rateId)

        if candidate:
            same_category = candidate.get("category") == category
            same_name = str(candidate.get("name", "")).casefold().strip() == name.casefold().strip()
            same_grade = (
                category != "MATERIAL"
                or str(candidate.get("grade", "")).casefold().strip() == grade.casefold().strip()
            )

            if same_category and same_name and same_grade:
                existing = candidate

    if existing is None:
        existing = _find_rate_for_sync(category, name, grade)

    all_rates = rates_list()

    if existing:
        rate_id = str(existing["id"])
        index = next(
            i
            for i, saved in enumerate(all_rates)
            if saved.get("id") == rate_id
        )

        saved = all_rates[index]

        item = {
            **saved,
            "category": category,
            "name": name,
            "grade": grade,
            "unit": row.unit.strip() or saved.get("unit", "job"),
            "price": max(0.0, float(row.rate or 0)),
            "active": True,
            "updated_at": now(),
        }

        all_rates[index] = item
    else:
        rate_id = "RATE-AUTO-" + uuid.uuid4().hex[:10].upper()

        item = {
            "id": rate_id,
            "category": category,
            "name": name,
            "grade": grade,
            "unit": row.unit.strip() or "job",
            "price": max(0.0, float(row.rate or 0)),
            "critical_score": _default_rate_critical(category),
            "active": True,
            "notes": "Auto-added from costing sheet",
            "updated_at": now(),
        }

        all_rates.append(item)

    save("rates", all_rates)

    row.category = category
    row.rateId = rate_id
    row.rateSource = "Rate Master"
    row.criticalScore = int(
        item.get("critical_score", _default_rate_critical(category))
    )
    row.rate = float(item.get("price", row.rate))
    row.cost = row.costingQty * row.rate

    return {
        "row": row,
        "rate": item,
    }


@app.post("/api/rates", response_model=RateItem)
def add_rate(value: RateItem):
    rows = rates_list()
    item = value.model_dump()
    item["id"] = item.get("id") or "RATE-" + uuid.uuid4().hex[:10].upper()
    if any(r.get("id") == item["id"] for r in rows):
        item["id"] = "RATE-" + uuid.uuid4().hex[:10].upper()
    item["updated_at"] = now()
    rows.append(item)
    save("rates", rows)
    return item


@app.put("/api/rates/{rate_id}", response_model=RateItem)
def update_rate(rate_id: str, value: RateItem):
    rows = rates_list()
    index = next((i for i, r in enumerate(rows) if r.get("id") == rate_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Rate not found")
    item = value.model_dump()
    item["id"] = rate_id
    item["updated_at"] = now()
    rows[index] = item
    save("rates", rows)
    return item


@app.delete("/api/rates/{rate_id}")
def delete_rate(rate_id: str):
    rows = rates_list()
    new_rows = [r for r in rows if r.get("id") != rate_id]
    if len(new_rows) == len(rows):
        raise HTTPException(status_code=404, detail="Rate not found")
    save("rates", new_rows)
    return {"status": "deleted", "id": rate_id}


@app.post("/api/rates/apply", response_model=list[Row])
def apply_saved_rates(value: CostReq):
    updated: list[Row] = []
    for row in value.rows:
        saved = rate_by_id(row.rateId)
        if saved:
            row.rate = float(saved.get("price", row.rate))
            row.unit = saved.get("unit", row.unit)
            row.criticalScore = int(saved.get("critical_score", row.criticalScore))
            row.rateSource = "Rate Master"
            row.cost = row.costingQty * row.rate
        updated.append(row)
    return updated


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...), force_ai: bool = True):
    content = await file.read()

    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    filename = file.filename or "drawing.pdf"
    extension = Path(filename).suffix.lower()
    preview_image = make_drawing_preview(content, filename)

    file_hash = sha256(content).hexdigest()
    extraction_id = "EXT-" + uuid.uuid4().hex[:10].upper()

    # Reuse corrected data ONLY for the exact same file hash.
    memory = None if force_ai else reviewed_memory(file_hash)

    ai_raw = None
    text_preview = ""

    if memory:
        drawing = Drawing(**memory["drawing"])
        rows = [Row(**x) for x in memory["rows"]]
        source = "reviewed_memory"
        warnings = [
            "Exact previously reviewed drawing found. Saved engineer corrections were reused."
        ]

    elif extension == ".pdf":
        try:
            # PDF -> 300 DPI page image -> Vision AI -> structured JSON
            ai_raw = analyze_pdf_with_ai(content)

            if not isinstance(ai_raw, dict):
                raise ValueError("Vision AI did not return a JSON object.")

            drawing = ai_result_to_drawing(ai_raw)

            # Build editable costing rows from the AI extraction.
            # Quantities/features come from the drawing; prices come from Rate Master.
            rows = ai_result_to_rows(ai_raw, drawing)

            source = "vision_ai"
            warnings = []

            uncertain = ai_raw.get("missing_or_uncertain") or []
            if uncertain:
                warnings.append(
                    "Vision extraction completed, but some values require review: "
                    + ", ".join(str(x) for x in uncertain[:12])
                )

            missing_rate_rows = [
                row.item
                for row in rows
                if row.rate <= 0 and row.category in {"MATERIAL", "PROCESS", "LABOUR", "OTHER"}
            ]
            if missing_rate_rows:
                warnings.append(
                    "Rate Master values are missing for: "
                    + ", ".join(missing_rate_rows[:12])
                    + ". Enter approved rates before generating the final quotation."
                )

        except Exception as exc:
            # Do not silently fall back to a weak parser. Return the real
            # upstream cause so the UI can distinguish rate-limit/transient
            # Gemini failures from drawing/schema problems.
            message = str(exc)
            upper = message.upper()

            if any(
                marker in upper
                for marker in (
                    "429",
                    "RESOURCE_EXHAUSTED",
                    "RATE LIMIT",
                )
            ):
                status_code = 429
                reason = (
                    "Gemini rate limit reached. "
                    "Wait a few seconds and retry this drawing."
                )
            elif any(
                marker in upper
                for marker in (
                    "503",
                    "UNAVAILABLE",
                    "TIMEOUT",
                    "DEADLINE_EXCEEDED",
                )
            ):
                status_code = 503
                reason = (
                    "Gemini is temporarily unavailable. "
                    "Retry this drawing shortly."
                )
            else:
                status_code = 502
                reason = "Vision AI extraction failed."

            print(
                "[ANALYZE ERROR]",
                type(exc).__name__,
                message,
                flush=True,
            )

            raise HTTPException(
                status_code=status_code,
                detail=(
                    f"{reason} "
                    f"{type(exc).__name__}: {message}"
                ),
            ) from exc

    else:
        # Existing non-PDF safe parser/blank behavior.
        drawing, rows, source, warnings, text_preview = extract_drawing_fields(
            content, filename
        )

    settings = load("settings", defaults_settings())

    if settings.get("auto_dataset_capture", True):
        append_extraction_record(
            {
                "id": extraction_id,
                "created_at": now(),
                "filename": filename,
                "file_hash": file_hash,
                "source": source,
                "warnings": warnings,
                "drawing": drawing.model_dump(),
                "rows": [row.model_dump() for row in rows],
                "ai_raw": ai_raw,
            }
        )

    return {
        "extraction_id": extraction_id,
        "file_hash": file_hash,
        "learning_source": source,
        "extraction_warnings": warnings,
        "text_preview": text_preview,
        "preview_image": preview_image,
        "drawing": drawing,
        "rows": rows,
        "ai_raw": ai_raw,
    }


@app.post("/api/review")
def review(value: ReviewReq):
    record = {
        "id": "REVW-" + uuid.uuid4().hex[:10].upper(),
        "created_at": now(),
        "extraction_id": value.extraction_id,
        "file_hash": value.file_hash,
        "drawing": value.drawing.model_dump(),
        "rows": [r.model_dump() for r in value.rows],
    }

    reviewed_samples = append_review_record(record)

    return {
        "status": "saved",
        "reviewed_samples": reviewed_samples,
    }


@app.post("/api/calculate", response_model=Summary)
def calculate(value: CostReq):
    return calc(value.rows)


@app.get("/api/dataset/stats")
def dataset_stats():
    counts = dataset_counts_fast()
    settings = load("settings", defaults_settings())
    meta = load(
        "dataset_meta",
        {
            "version": 1,
            "reviewed_at_version": 0,
        },
    )

    reviewed = counts["reviews"]
    new_reviewed = max(
        0,
        reviewed - meta.get("reviewed_at_version", 0),
    )

    threshold = max(
        1,
        int(settings["training_batch_threshold"]),
    )

    return {
        "extractions": counts["extractions"],
        "reviewed_samples": reviewed,
        "unique_files": counts["unique_files"],
        "dataset_version": meta.get("version", 1),
        "new_reviewed_since_version": new_reviewed,
        "training_batch_threshold": threshold,
        "batch_ready": new_reviewed >= threshold,
        "auto_dataset_capture": settings["auto_dataset_capture"],
        "learn_from_corrections": settings["learn_from_corrections"],
    }


@app.get("/api/dataset/export")
def export_dataset():
    reviews = load("reviews", [])
    lines = "".join(
        json.dumps(
            {
                "input": {
                    "file_hash": r["file_hash"],
                    "extraction_id": r["extraction_id"],
                },
                "target": {"drawing": r["drawing"], "rows": r["rows"]},
            },
            ensure_ascii=False,
        )
        + "\n"
        for r in reviews
    )
    out = BytesIO(lines.encode("utf-8"))
    return StreamingResponse(
        out,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": 'attachment; filename="reviewed_training_dataset.jsonl"'},
    )


@app.post("/api/revisions")
def add_revision(value: RevisionReq):
    record = {
        "id": "R-" + uuid.uuid4().hex[:8].upper(),
        "created_at": now(),
        "drawing_no": value.drawing.drawing_no,
        "revision": value.drawing.revision,
        "description": value.drawing.description,
        "material": value.drawing.material,
        "note": value.note,
    }
    rows = load("revisions", [])
    rows.append(record)
    save("revisions", rows)
    return record


@app.get("/api/revisions/{drawing_no}")
def revisions(drawing_no: str):
    return [x for x in load("revisions", []) if x.get("drawing_no") == drawing_no]


@app.post("/api/quotations")
def add_quote(value: QuoteReq):
    record = {
        "id": "Q-" + datetime.now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:5].upper(),
        "created_at": now(),
        "customer": value.customer,
        "drawing_no": value.drawing.drawing_no,
        "revision": value.drawing.revision,
        "description": value.drawing.description,
        "selling_price": value.summary.selling_price,
        "status": value.status,
        "drawing": value.drawing.model_dump(),
        "summary": value.summary.model_dump(),
        "rows": [row.model_dump() for row in value.rows],
    }
    rows = load("quotations", [])
    rows.append(record)
    save("quotations", rows)
    return record


@app.post("/api/quotations/batch")
def add_batch_quote(value: BatchSaveReq):
    if not value.items:
        raise HTTPException(status_code=400, detail="No drawings supplied.")

    saved = load("quotations", [])
    created: list[dict] = []

    if value.mode == "separate":
        for item in value.items:
            record = {
                "id": "Q-" + datetime.now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:5].upper(),
                "created_at": now(),
                "customer": value.customer,
                "drawing_no": item.drawing.drawing_no,
                "revision": item.drawing.revision,
                "description": item.drawing.description,
                "selling_price": item.summary.selling_price,
                "status": value.status,
                "batch_mode": "separate",
                "drawing": item.drawing.model_dump(),
                "summary": item.summary.model_dump(),
                "rows": [row.model_dump() for row in item.rows],
            }
            saved.append(record)
            created.append(record)
    else:
        total = round(sum(item.summary.selling_price for item in value.items), 2)
        drawing_numbers = [item.drawing.drawing_no for item in value.items]

        record = {
            "id": "Q-" + datetime.now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:5].upper(),
            "created_at": now(),
            "customer": value.customer,
            "drawing_no": f"{len(value.items)} DRAWINGS",
            "revision": "MULTI",
            "description": "Merged quotation: " + ", ".join(drawing_numbers[:8]),
            "selling_price": total,
            "status": value.status,
            "batch_mode": "merge",
            "drawing_numbers": drawing_numbers,
            "drawing_count": len(value.items),
            "items": [
                {
                    "drawing": item.drawing.model_dump(),
                    "summary": item.summary.model_dump(),
                    "rows": [row.model_dump() for row in item.rows],
                }
                for item in value.items
            ],
        }
        saved.append(record)
        created.append(record)

    save("quotations", saved)

    return {
        "mode": value.mode,
        "count": len(created),
        "records": created,
        "id": created[0]["id"],
    }


@app.get("/api/quotations")
def quotations():
    return load("quotations", [])


@app.post("/api/export/excel")
def excel(value: ExportReq):
    wb = Workbook()
    ws = wb.active
    ws.title = "Cost Estimate"

    navy = "17365D"
    thin = Side(style="thin", color="D9D9D9")
    ws.merge_cells("A1:J1")
    ws["A1"] = "AI MANUFACTURING COST ESTIMATE"
    ws["A1"].font = Font(bold=True, color="FFFFFF", size=16)
    ws["A1"].fill = PatternFill("solid", fgColor=navy)
    ws["A1"].alignment = Alignment(horizontal="center")

    meta = [
        ("Drawing No.", value.drawing.drawing_no),
        ("Revision", value.drawing.revision),
        ("Description", value.drawing.description),
        ("Material", value.drawing.material),
        ("Thickness mm", value.drawing.thickness_mm),
        ("Weight kg", value.drawing.weight_kg),
        ("Quantity", value.drawing.quantity),
    ]
    for i, (key, val) in enumerate(meta, 3):
        ws[f"A{i}"] = key
        ws[f"B{i}"] = val
        ws[f"A{i}"].font = Font(bold=True)

    start = 12
    headers = [
        "Category",
        "Item / Process",
        "Drawing Qty",
        "Costing Qty",
        "Unit",
        "Rate",
        "Rate Source",
        "Criticality Score",
        "Status",
        "Estimated Cost",
    ]
    for column, header in enumerate(headers, 1):
        cell = ws.cell(start, column, header)
        cell.font = Font(bold=True, color=navy)
        cell.fill = PatternFill("solid", fgColor="D9EAF7")
        cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
        cell.alignment = Alignment(horizontal="center")

    settings = load("settings", defaults_settings())
    medium = int(settings.get("critical_medium_threshold", 40))
    high = int(settings.get("critical_high_threshold", 70))

    for row_no, row in enumerate(value.rows, start + 1):
        vals = [
            row.category,
            row.item,
            row.drawingQty,
            row.costingQty,
            row.unit,
            row.rate,
            row.rateSource,
            row.criticalScore,
            row.confidence,
            row.costingQty * row.rate,
        ]
        for col_no, val in enumerate(vals, 1):
            cell = ws.cell(row_no, col_no, val)
            cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
        ws.cell(row_no, 6).number_format = "₹#,##0.00"
        ws.cell(row_no, 10).number_format = "₹#,##0.00"

        score_cell = ws.cell(row_no, 8)
        if row.criticalScore >= high:
            score_cell.fill = PatternFill("solid", fgColor="F4CCCC")
            score_cell.font = Font(color="9C0006", bold=True)
        elif row.criticalScore >= medium:
            score_cell.fill = PatternFill("solid", fgColor="FFF2CC")
            score_cell.font = Font(color="7F6000", bold=True)
        else:
            score_cell.fill = PatternFill("solid", fgColor="D9EAD3")
            score_cell.font = Font(color="274E13", bold=True)

    summary_row = start + len(value.rows) + 3
    summary = [
        ("Direct Cost", value.summary.direct_cost),
        (f"Material Wastage ({value.summary.material_wastage_pct:g}% | C{value.summary.material_wastage_critical})", value.summary.material_wastage),
        (f"Factory Overhead ({value.summary.overhead_pct:g}% | C{value.summary.overhead_critical})", value.summary.overhead),
        ("Manufacturing Cost", value.summary.manufacturing_cost),
        (f"Markup ({value.summary.markup_pct:g}% | C{value.summary.markup_critical})", value.summary.markup),
        ("Selling Price", value.summary.selling_price),
    ]
    for i, (key, val) in enumerate(summary, summary_row):
        ws[f"I{i}"] = key
        ws[f"J{i}"] = val
        ws[f"I{i}"].font = Font(bold=True)
        ws[f"J{i}"].number_format = "₹#,##0.00"

    widths = {
        "A": 15,
        "B": 38,
        "C": 18,
        "D": 14,
        "E": 12,
        "F": 14,
        "G": 20,
        "H": 18,
        "I": 15,
        "J": 18,
    }
    for col, width in widths.items():
        ws.column_dimensions[col].width = width

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{value.drawing.drawing_no}_cost_estimate.xlsx"'
        },
    )


@app.post("/api/export/pdf")
def pdf(value: PdfReq):
    # Customer-facing PDF intentionally excludes internal criticality/risk scores.
    out = BytesIO()
    doc = SimpleDocTemplate(
        out,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph("QUOTATION", styles["Title"]),
        Spacer(1, 5 * mm),
        Paragraph(f"<b>Customer:</b> {value.customer}", styles["BodyText"]),
        Paragraph(
            f"<b>Drawing:</b> {value.drawing.drawing_no} / {value.drawing.revision}",
            styles["BodyText"],
        ),
        Paragraph(f"<b>Description:</b> {value.drawing.description}", styles["BodyText"]),
        Spacer(1, 5 * mm),
    ]

    data = [["Item / Process", "Qty", "Unit", "Rate (INR)", "Cost (INR)"]] + [
        [
            row.item,
            f"{row.costingQty:g}",
            row.unit,
            f"{row.rate:,.2f}",
            f"{row.costingQty * row.rate:,.2f}",
        ]
        for row in value.rows
    ]
    table = Table(data, colWidths=[76 * mm, 20 * mm, 18 * mm, 26 * mm, 30 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17365D")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9D9D9")),
            ]
        )
    )
    story += [table, Spacer(1, 6 * mm)]

    sums = [
        ["Direct Cost", f"INR {value.summary.direct_cost:,.2f}"],
        [f"Material Wastage ({value.summary.material_wastage_pct:g}%)", f"INR {value.summary.material_wastage:,.2f}"],
        [f"Factory Overhead ({value.summary.overhead_pct:g}%)", f"INR {value.summary.overhead:,.2f}"],
        ["Manufacturing Cost", f"INR {value.summary.manufacturing_cost:,.2f}"],
        [f"Markup ({value.summary.markup_pct:g}%)", f"INR {value.summary.markup:,.2f}"],
        ["Selling Price", f"INR {value.summary.selling_price:,.2f}"],
    ]
    summary_table = Table(sums, colWidths=[65 * mm, 45 * mm], hAlign="RIGHT")
    summary_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9D9D9")),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#E2F0D9")),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )
    story.append(summary_table)
    doc.build(story)
    out.seek(0)
    return StreamingResponse(
        out,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{value.drawing.drawing_no}_quotation.pdf"'
        },
    )


def _safe_pdf_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "drawing")
    return cleaned.strip("._") or "drawing"


def _render_single_batch_pdf(
    customer: str,
    item: BatchQuoteItem,
) -> bytes:
    out = BytesIO()
    doc = SimpleDocTemplate(
        out,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )

    styles = getSampleStyleSheet()

    story = [
        Paragraph("QUOTATION", styles["Title"]),
        Spacer(1, 5 * mm),
        Paragraph(f"<b>Customer:</b> {customer}", styles["BodyText"]),
        Paragraph(
            f"<b>Drawing:</b> {item.drawing.drawing_no} / {item.drawing.revision}",
            styles["BodyText"],
        ),
        Paragraph(
            f"<b>Description:</b> {item.drawing.description}",
            styles["BodyText"],
        ),
        Spacer(1, 5 * mm),
    ]

    data = [["Item / Process", "Qty", "Unit", "Rate (INR)", "Cost (INR)"]] + [
        [
            row.item,
            f"{row.costingQty:g}",
            row.unit,
            f"{row.rate:,.2f}",
            f"{row.costingQty * row.rate:,.2f}",
        ]
        for row in item.rows
    ]

    table = Table(
        data,
        colWidths=[76 * mm, 20 * mm, 18 * mm, 26 * mm, 30 * mm],
        repeatRows=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17365D")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9D9D9")),
            ]
        )
    )

    story += [table, Spacer(1, 6 * mm)]

    sums = [
        ["Direct Cost", f"INR {item.summary.direct_cost:,.2f}"],
        [
            f"Material Wastage ({item.summary.material_wastage_pct:g}%)",
            f"INR {item.summary.material_wastage:,.2f}",
        ],
        [
            f"Factory Overhead ({item.summary.overhead_pct:g}%)",
            f"INR {item.summary.overhead:,.2f}",
        ],
        ["Manufacturing Cost", f"INR {item.summary.manufacturing_cost:,.2f}"],
        [
            f"Markup ({item.summary.markup_pct:g}%)",
            f"INR {item.summary.markup:,.2f}",
        ],
        ["Selling Price", f"INR {item.summary.selling_price:,.2f}"],
    ]

    summary_table = Table(
        sums,
        colWidths=[65 * mm, 45 * mm],
        hAlign="RIGHT",
    )
    summary_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9D9D9")),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#E2F0D9")),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )

    story.append(summary_table)
    doc.build(story)

    return out.getvalue()


def _render_merged_batch_pdf(
    customer: str,
    items: list[BatchQuoteItem],
) -> bytes:
    out = BytesIO()
    doc = SimpleDocTemplate(
        out,
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )

    styles = getSampleStyleSheet()

    story = [
        Paragraph("QUOTATION", styles["Title"]),
        Spacer(1, 4 * mm),
        Paragraph(f"<b>Customer:</b> {customer}", styles["BodyText"]),
        Paragraph(
            f"<b>Drawings:</b> {len(items)}",
            styles["BodyText"],
        ),
        Spacer(1, 5 * mm),
    ]

    data = [
        [
            "Sl.",
            "Drawing No.",
            "Rev",
            "Description",
            "Qty",
            "Unit Price (INR)",
            "Line Total (INR)",
        ]
    ]

    grand_total = 0.0

    for index, item in enumerate(items, 1):
        qty = max(1, int(item.drawing.quantity or 1))
        line_total = float(item.summary.selling_price)
        unit_price = line_total / qty if qty else line_total
        grand_total += line_total

        data.append(
            [
                str(index),
                item.drawing.drawing_no,
                item.drawing.revision,
                item.drawing.description,
                str(qty),
                f"{unit_price:,.2f}",
                f"{line_total:,.2f}",
            ]
        )

    table = Table(
        data,
        colWidths=[
            9 * mm,
            24 * mm,
            13 * mm,
            65 * mm,
            12 * mm,
            27 * mm,
            29 * mm,
        ],
        repeatRows=1,
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17365D")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.4),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9D9D9")),
                ("ALIGN", (4, 1), (-1, -1), "RIGHT"),
            ]
        )
    )

    story += [table, Spacer(1, 6 * mm)]

    total_table = Table(
        [
            ["Grand Total", f"INR {grand_total:,.2f}"],
        ],
        colWidths=[65 * mm, 45 * mm],
        hAlign="RIGHT",
    )

    total_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#B8C5D3")),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#E2F0D9")),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ]
        )
    )

    story.append(total_table)
    doc.build(story)

    return out.getvalue()


@app.post("/api/export/pdf-batch")
def batch_pdf(value: BatchPdfReq):
    if not value.items:
        raise HTTPException(status_code=400, detail="No drawings supplied.")

    if value.mode == "merge":
        payload = _render_merged_batch_pdf(
            value.customer,
            value.items,
        )

        out = BytesIO(payload)

        return StreamingResponse(
            out,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="merged_quotation.pdf"'
            },
        )

    archive = BytesIO()

    with zipfile.ZipFile(
        archive,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as bundle:
        for index, item in enumerate(value.items, 1):
            pdf_bytes = _render_single_batch_pdf(
                value.customer,
                item,
            )

            drawing_name = _safe_pdf_name(
                item.drawing.drawing_no or f"drawing_{index}"
            )

            bundle.writestr(
                f"{index:02d}_{drawing_name}_quotation.pdf",
                pdf_bytes,
            )

    archive.seek(0)

    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="separate_quotations.zip"'
        },
    )
