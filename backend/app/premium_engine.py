from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any
import math
import re


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _text(value: Any) -> str:
    return str(value or "").strip()


def _norm(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", "", _text(value).upper())


def _features(ai_raw: dict, key: str) -> list[dict]:
    return [x for x in (ai_raw.get(key) or []) if isinstance(x, dict)]


def _rate_match(rates: list[dict], category: str, names: list[str], preferred_unit: str = "") -> dict | None:
    active = [r for r in rates if r.get("active", True) and _text(r.get("category")).upper() == category]
    if not active:
        return None
    candidates: list[tuple[int, dict]] = []
    tokens = [_norm(x) for x in names if _text(x)]
    for rate in active:
        rn = _norm(rate.get("name"))
        score = 0
        for token in tokens:
            if token and (token in rn or rn in token):
                score = max(score, min(len(token), len(rn)) + 20)
        if preferred_unit and _text(rate.get("unit")).lower() == preferred_unit.lower():
            score += 5
        if score:
            candidates.append((score, rate))
    if not candidates:
        return None
    return sorted(candidates, key=lambda x: (-x[0], _num(x[1].get("price"))))[0][1]


def _overall_mm(ai_raw: dict) -> tuple[float, float, float]:
    dims: list[tuple[str, float]] = []
    for row in _features(ai_raw, "dimensions"):
        val = _num(row.get("value_mm") or row.get("value"))
        if val <= 0:
            continue
        label = _text(row.get("label") or row.get("callout"))
        bad = any(x in label.lower() for x in ("diameter", "hole", "radius", "chamfer", "thread", "pitch"))
        if not bad:
            dims.append((label, val))
    cad = ai_raw.get("cad_geometry") or {}
    cad_dims = cad.get("dimensions_mm") or {}
    for key in ("x", "y", "z"):
        val = _num(cad_dims.get(key))
        if val > 0:
            dims.append((key, val))
    values = sorted({round(v, 6) for _, v in dims if v > 0}, reverse=True)
    while len(values) < 3:
        values.append(0.0)
    return values[0], values[1], values[2]


def _process_route(ai_raw: dict) -> list[str]:
    route = [_text(x) for x in (ai_raw.get("process_route") or []) if _text(x)]
    if not route:
        route = [_text(x.get("process")) for x in _features(ai_raw, "manufacturing_processes") if _text(x.get("process"))]
    if not route:
        route = [_text(x) for x in (ai_raw.get("manufacturing_types") or []) if _text(x)]
    if not route:
        route = [_text((ai_raw.get("engineering_intelligence") or {}).get("primary_manufacturing_type"))]
    route = [x for x in route if x]
    seen: set[str] = set()
    unique: list[str] = []
    for value in route:
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(value)
    if not any("inspect" in x.lower() or "qc" in x.lower() for x in unique):
        unique.append("Inspection & Handling")
    return unique


def _process_characteristics(process: str, ai_raw: dict, drawing: dict) -> tuple[float, float, float, str, list[str], str]:
    """setup_hr, run_hr_per_piece, days, preferred_unit, rate names, reason"""
    p = process.lower()
    qty_holes = sum(max(1, int(_num(x.get("quantity"), 1))) for x in _features(ai_raw, "holes"))
    qty_threads = sum(max(1, int(_num(x.get("quantity"), 1))) for x in _features(ai_raw, "threads"))
    qty_bends = sum(max(1, int(_num(x.get("quantity"), 1))) for x in _features(ai_raw, "bends"))
    weld_len_m = sum(_num(x.get("length_mm")) * max(1, int(_num(x.get("quantity"), 1))) for x in _features(ai_raw, "welds")) / 1000
    weight = max(_num(drawing.get("weight_kg")), _num(ai_raw.get("weight_kg")))

    if "laser" in p:
        return .35, max(.08, weight / 220), .5, "hr", ["Laser Cutting", "Laser"], "Blank/profile cutting inferred from part form and route."
    if "sheet" in p or "bend" in p or "forming" in p:
        return .35, max(.08, qty_bends * .08), .5, "hr", ["Press Brake", "Bending", "Sheet-Metal"], f"{qty_bends or 1} bend/forming operations."
    if "turn" in p:
        return .55, max(.18, weight / 70), 1.0, "hr", ["CNC Turning", "Turning"], "Rotational machining route."
    if "mill" in p:
        return .65, max(.22, weight / 55), 1.0, "hr", ["CNC Milling", "Milling"], "Prismatic/multi-face machining route."
    if "machin" in p:
        return .55, max(.20, weight / 60), 1.0, "hr", ["General Machining", "CNC Milling"], "General machining allowance from geometry/route."
    if "drill" in p or "bor" in p:
        return .20, max(.05, qty_holes * .025), .35, "hr", ["Drilling / Boring", "Drilling"], f"{qty_holes} drilled/boring features."
    if "thread" in p or "tap" in p:
        return .18, max(.04, qty_threads * .035), .35, "hr", ["Threading / Tapping", "Tapping"], f"{qty_threads} threaded features."
    if "weld" in p or "fabricat" in p:
        return .45, max(.18, weld_len_m * .28 if weld_len_m else weight / 90), 1.0, "hr", ["General / Tack Welding", "TIG Welding", "MIG Welding"], "Welding/fabrication from weld route and extracted features."
    if "grind" in p or "finish" in p or "polish" in p:
        return .15, max(.10, weight / 180), .5, "hr", ["Grinding & Flush", "Polishing", "Deburring"], "Finishing from route/surface notes."
    if "tube" in p or "pipe" in p:
        return .30, max(.15, weight / 100), .75, "hr", ["Saw / Raw Stock Cutting", "General Machining"], "Tube/pipe preparation and fabrication."
    if "assembly" in p or "integration" in p:
        parts = len(_features(ai_raw, "assembly_parts"))
        return .30, max(.15, parts * .08), .75, "hr", ["General / Tack Welding", "Inspection & Handling"], f"Assembly/integration of {parts or 1} identified components."
    if "inspect" in p or "qc" in p or "handling" in p:
        return .10, .12, .25, "hr", ["Inspection & Handling"], "Final inspection/handling allowance."
    if "cast" in p or "forg" in p or "extrus" in p or "additive" in p:
        return .75, max(.3, weight / 100), 2.0, "hr", [process, "General Machining"], "Special primary manufacturing route; estimator review recommended."
    return .25, .12, .5, "hr", [process, "General Machining"], "Route-stage allowance; review before release."


def _requirements(ai_raw: dict) -> list[dict]:
    reqs: list[dict] = []
    notes = " ".join(_text(x) for x in (ai_raw.get("notes") or [])).upper()
    dimensions = _features(ai_raw, "dimensions")
    checks = [
        ("Tolerance / GD&T", bool(re.search(r"(?:±|TOLERANCE|GD&T|POSITION|FLATNESS|PERPENDICULAR|RUNOUT)", notes)) or any(_text(x.get("tolerance")) for x in dimensions), "Review tolerance impact and inspection method."),
        ("Surface finish", bool(ai_raw.get("surface_finish")) or any(k in notes for k in ("RA ", "ROUGHNESS", "POLISH", "FINISH")), "Include finishing and roughness requirements in route."),
        ("Heat treatment", any(k in notes for k in ("HEAT TREAT", "HARDEN", "ANNEAL", "NORMALIZ", "TEMPER")), "Confirm external/internal heat-treatment rate and lead time."),
        ("NDT / inspection", any(k in notes for k in ("NDT", "DPT", "MPI", "UT ", "RADIOGRAPH", "X-RAY", "INSPECTION")), "Include inspection/NDT commercial requirement."),
        ("Welding standard", bool(ai_raw.get("welds")) or any(k in notes for k in ("WPS", "PQR", "WELD")), "Verify WPS/PQR, consumables and weld inspection."),
        ("Coating / painting", any(k in notes for k in ("PAINT", "POWDER", "COAT", "GALVAN", "PASSIV")), "Include coating preparation and external process if required."),
        ("Material certificate", any(k in notes for k in ("MTC", "MATERIAL CERT", "3.1 CERT", "EN 10204")), "Add certificate/document requirement."),
        ("Packing / preservation", any(k in notes for k in ("PACK", "PRESERV", "EXPORT PACK", "WOODEN")), "Include packing/preservation cost."),
    ]
    for name, detected, action in checks:
        if detected:
            reqs.append({"name": name, "severity": "review" if name not in {"Tolerance / GD&T", "NDT / inspection"} else "high", "action": action})
    return reqs


def _dfm_warnings(ai_raw: dict, drawing: dict) -> list[dict]:
    warnings: list[dict] = []
    thickness = _num(ai_raw.get("thickness_mm") or drawing.get("thickness_mm"))
    for row in _features(ai_raw, "holes"):
        dia = _num(row.get("diameter_mm"))
        if thickness and dia and dia < thickness * .8:
            warnings.append({"severity": "review", "message": f"Small hole Ø{dia:g} mm relative to {thickness:g} mm thickness may need drilling rather than thermal cutting."})
    for row in _features(ai_raw, "dimensions"):
        tol = _text(row.get("tolerance"))
        match = re.search(r"([0-9]+(?:\.[0-9]+)?)", tol)
        if match and _num(match.group(1), 9) <= .02:
            warnings.append({"severity": "high", "message": f"Tight tolerance {tol} detected; add controlled machining and inspection time."})
    if ai_raw.get("bends") and thickness >= 20:
        warnings.append({"severity": "review", "message": "Heavy-section bending detected; verify press capacity, bend radius and springback allowance."})
    if ai_raw.get("welds") and _num(drawing.get("weight_kg")) >= 100:
        warnings.append({"severity": "review", "message": "Heavy weldment: review distortion control, sequence and post-weld correction allowance."})
    return warnings[:12]


def _similar_jobs(drawing: dict, ai_raw: dict, quotations: list[dict]) -> list[dict]:
    target_desc = _text(drawing.get("description"))
    target_mat = _text(drawing.get("material"))
    target_no = _text(drawing.get("drawing_no"))
    target_weight = _num(drawing.get("weight_kg"))
    output: list[dict] = []
    for q in quotations:
        d = q.get("drawing") or {}
        score = 0.0
        score += SequenceMatcher(None, target_desc.lower(), _text(d.get("description")).lower()).ratio() * 45
        if target_mat and _norm(target_mat) == _norm(d.get("material")):
            score += 25
        if target_no and _norm(target_no) == _norm(d.get("drawing_no")):
            score += 20
        old_weight = _num(d.get("weight_kg"))
        if target_weight and old_weight:
            score += max(0, 10 - abs(target_weight - old_weight) / max(target_weight, old_weight) * 10)
        if score < 30:
            continue
        summary = q.get("summary") or {}
        output.append({
            "id": q.get("id", ""),
            "score": round(min(99, score), 1),
            "drawing_no": d.get("drawing_no", ""),
            "description": d.get("description", ""),
            "material": d.get("material", ""),
            "weight_kg": old_weight,
            "selling_price": _num(summary.get("selling_price") or q.get("selling_price")),
            "status": q.get("status", ""),
            "created_at": q.get("created_at", ""),
        })
    return sorted(output, key=lambda x: x["score"], reverse=True)[:5]


def _quantity_breaks(base_direct: float, fixed_setup: float, variable_piece: float, markup_pct: float, current_qty: int) -> list[dict]:
    quantities = sorted({1, 5, 10, 25, 50, 100, max(1, current_qty)})
    output: list[dict] = []
    for qty in quantities:
        variable = variable_piece * qty
        total_cost = fixed_setup + variable
        sell = total_cost * (1 + markup_pct / 100)
        output.append({"quantity": qty, "unit_price": round(sell / qty, 2), "total_price": round(sell, 2), "setup_cost": round(fixed_setup, 2)})
    return output


def build_premium_estimate(*, drawing: dict, rows: list[dict], ai_raw: dict, rates: list[dict], settings: dict, quotations: list[dict], actuals: list[dict] | None = None) -> dict:
    qty = max(1, int(_num(drawing.get("quantity") or ai_raw.get("product_quantity"), 1)))
    route = _process_route(ai_raw)
    processes: list[dict] = []
    fixed_setup = 0.0
    variable_piece = 0.0
    route_days = 0.0

    for index, process in enumerate(route):
        setup_hr, run_hr, days, preferred_unit, names, reason = _process_characteristics(process, ai_raw, drawing)
        rate = _rate_match(rates, "PROCESS", names, preferred_unit)
        labour = None
        if any(x in process.lower() for x in ("weld", "fabricat")):
            labour = _rate_match(rates, "LABOUR", ["Welder / Fabricator", "TIG Welder", "MIG Welder"], "hr")
        elif any(x in process.lower() for x in ("machine", "mill", "turn", "drill", "thread")):
            labour = _rate_match(rates, "LABOUR", ["Machinist", "Machine Operator"], "hr")
        elif any(x in process.lower() for x in ("grind", "finish", "polish")):
            labour = _rate_match(rates, "LABOUR", ["Finishing Operator"], "hr")

        machine_rate = _num((rate or {}).get("price"))
        labour_rate = _num((labour or {}).get("price"))
        setup_cost = setup_hr * (machine_rate + labour_rate)
        run_piece_cost = run_hr * (machine_rate + labour_rate)
        fixed_setup += setup_cost
        variable_piece += run_piece_cost
        route_days += days
        processes.append({
            "sequence": index + 1,
            "process": process,
            "setup_hours": round(setup_hr, 3),
            "run_hours_per_piece": round(run_hr, 3),
            "machine_rate": round(machine_rate, 2),
            "labour_rate": round(labour_rate, 2),
            "setup_cost": round(setup_cost, 2),
            "run_cost_per_piece": round(run_piece_cost, 2),
            "total_cost": round(setup_cost + run_piece_cost * qty, 2),
            "lead_days": round(days, 2),
            "rate_source": _text((rate or {}).get("name")) or "Rate Master missing",
            "confidence": 88 if rate else 62,
            "reason": reason,
        })

    material_row = next((r for r in rows if _text(r.get("category")).upper() == "MATERIAL"), None)
    material_cost = _num((material_row or {}).get("cost")) or _num((material_row or {}).get("costingQty")) * _num((material_row or {}).get("rate"))
    other_cost = sum(_num(r.get("cost")) or _num(r.get("costingQty")) * _num(r.get("rate")) for r in rows if _text(r.get("category")).upper() not in {"MATERIAL", "PROCESS", "LABOUR"})
    process_cost = sum(x["total_cost"] for x in processes)
    direct_estimated = material_cost + process_cost + other_cost
    current_direct = sum(_num(r.get("cost")) or _num(r.get("costingQty")) * _num(r.get("rate")) for r in rows)
    direct_for_margin = max(current_direct, direct_estimated)
    markup_pct = _num(settings.get("markup_pct"), 15)
    target_sell = direct_for_margin * (1 + _num(settings.get("material_wastage_pct"), 0) / 100) * (1 + _num(settings.get("overhead_pct"), 0) / 100) * (1 + markup_pct / 100)
    margin_pct = ((target_sell - direct_for_margin) / target_sell * 100) if target_sell else 0

    width, height, depth = _overall_mm(ai_raw)
    sheet_area = width * height if width and height else 0
    standard_area = 2500 * 1250
    utilization = min(94.0, max(35.0, 100 * sheet_area / standard_area)) if sheet_area else 0
    parts_per_sheet = max(1, int(standard_area // sheet_area)) if sheet_area else 0

    assembly_parts = []
    bought_out = []
    for part in _features(ai_raw, "assembly_parts"):
        entry = {
            "item_no": _text(part.get("item_no")),
            "part_name": _text(part.get("part_name")),
            "quantity": max(1, int(_num(part.get("quantity"), 1))),
            "material": _text(part.get("material")),
            "thickness_mm": _num(part.get("thickness_mm")),
            "size": " × ".join(f"{_num(part.get(k)):g}" for k in ("length_mm", "width_mm", "height_mm") if _num(part.get(k)) > 0),
        }
        assembly_parts.append(entry)
        combined = f"{entry['part_name']} {entry['material']}".upper()
        if any(k in combined for k in ("BOLT", "NUT", "WASHER", "BEARING", "MOTOR", "GEARBOX", "VALVE", "FASTENER", "FITTING")):
            bought_out.append(entry)

    requirements = _requirements(ai_raw)
    dfm = _dfm_warnings(ai_raw, drawing)
    intel = ai_raw.get("engineering_intelligence") or {}
    completeness = intel.get("completeness") or {}
    confidence = {
        "engineering": int(_num(completeness.get("engineering_data"), _num(ai_raw.get("classification_confidence"), 70))),
        "classification": int(_num(intel.get("classification_confidence"), _num(ai_raw.get("classification_confidence"), 70))),
        "cost": int(_num(completeness.get("cost_confidence"), 70)),
        "rate_coverage": int(_num(completeness.get("rate_coverage"), 0)),
    }
    missing_rates = [p["process"] for p in processes if p["machine_rate"] <= 0]
    attention = list(dict.fromkeys([_text(x) for x in (ai_raw.get("missing_or_uncertain") or []) if _text(x)] + [f"Rate Master: {x}" for x in missing_rates]))

    lead_days = max(1, math.ceil(route_days + (2 if material_cost > 0 else 0)))
    approval = "Estimator"
    approval_reason = "Standard quote"
    if target_sell >= 500000:
        approval, approval_reason = "Manager", "Quotation value ≥ ₹5,00,000"
    if margin_pct < 15:
        approval, approval_reason = "Director", "Estimated margin below 15%"

    base_variable = material_cost / qty + variable_piece + other_cost / qty
    quantity_breaks = _quantity_breaks(direct_for_margin, fixed_setup, base_variable, markup_pct, qty)

    similar = _similar_jobs(drawing, ai_raw, quotations)
    actuals = actuals or []
    variance_samples = [x for x in actuals if _norm((x.get("drawing") or {}).get("material")) == _norm(drawing.get("material"))]
    variance = {"samples": len(variance_samples), "cost_bias_pct": 0.0, "time_bias_pct": 0.0}
    if variance_samples:
        cost_biases = []
        time_biases = []
        for sample in variance_samples:
            quoted = _num(sample.get("quoted_cost"))
            actual = _num(sample.get("actual_cost"))
            qh = _num(sample.get("quoted_hours"))
            ah = _num(sample.get("actual_hours"))
            if quoted: cost_biases.append((actual - quoted) / quoted * 100)
            if qh: time_biases.append((ah - qh) / qh * 100)
        if cost_biases: variance["cost_bias_pct"] = round(sum(cost_biases) / len(cost_biases), 1)
        if time_biases: variance["time_bias_pct"] = round(sum(time_biases) / len(time_biases), 1)

    cost_drivers = sorted([
        {"name": "Material", "amount": round(material_cost, 2)},
        {"name": "Manufacturing processes", "amount": round(process_cost, 2)},
        {"name": "Other / packing / consumables", "amount": round(other_cost, 2)},
    ], key=lambda x: x["amount"], reverse=True)

    savings: list[str] = []
    if utilization and utilization < 70:
        savings.append("Review blank orientation/nesting: estimated sheet utilization is below 70%.")
    if similar:
        savings.append("Compare the top similar historical quotation before release to reuse proven rates and lead time.")
    if any(x["machine_rate"] <= 0 for x in processes):
        savings.append("Complete missing process rates in Rate Master to remove assumed-cost risk.")
    if qty >= 10:
        savings.append("Use quantity-break pricing so setup cost is amortized rather than multiplied per piece.")

    return {
        "process_route": processes,
        "requirements": requirements,
        "dfm_warnings": dfm,
        "confidence": confidence,
        "attention": attention[:20],
        "similar_jobs": similar,
        "quantity_breaks": quantity_breaks,
        "lead_time": {"working_days": lead_days, "basis": "Material + routed process stages", "expedite_days": max(1, math.ceil(lead_days * .65))},
        "margin": {"estimated_direct_cost": round(direct_for_margin, 2), "recommended_sell": round(target_sell, 2), "gross_margin_pct": round(margin_pct, 1), "target_markup_pct": markup_pct, "approval_role": approval, "approval_reason": approval_reason},
        "nesting": {"available": bool(sheet_area), "blank_width_mm": round(width, 3), "blank_height_mm": round(height, 3), "standard_sheet": "2500 × 1250 mm", "parts_per_sheet": parts_per_sheet, "utilization_pct": round(utilization, 1), "scrap_pct": round(100-utilization, 1) if utilization else 0},
        "assembly": {"parts": assembly_parts, "bought_out": bought_out},
        "learning": variance,
        "cost_drivers": cost_drivers,
        "savings": savings,
        "what_if": {"material_plus_5": round(target_sell + material_cost * .05 * (1 + markup_pct/100), 2), "urgent_delivery": round(target_sell * 1.08, 2), "markup_minus_3": round(direct_for_margin * (1 + max(0, markup_pct-3)/100), 2)},
    }
