import base64
import json
import re
from typing import Any

import httpx

from .config import settings
from .models import Evidence, Extraction, ProcessSuggestion


FIELD_NAMES = (
    "drawing_number",
    "revision",
    "description",
    "material",
    "quantity",
    "length_mm",
    "width_mm",
    "thickness_mm",
    "diameter_mm",
    "drawing_weight_kg",
    "units",
    "tolerance",
    "surface_finish",
    "weld_details",
    "hole_thread_details",
    "heat_treatment",
    "coating",
)

PROMPT = """
You are an engineering drawing extraction engine for manufacturing quotation.
Read only facts visible in the attached drawing. Do not calculate weight, price,
or manufacturing cost. Do not guess hidden dimensions. Prefer title block and
explicit notes over visual assumptions.

Return ONLY valid JSON with this exact shape:
{
  "drawing_number": {"value": null, "confidence": 0, "evidence": null},
  "revision": {"value": null, "confidence": 0, "evidence": null},
  "description": {"value": null, "confidence": 0, "evidence": null},
  "material": {"value": null, "confidence": 0, "evidence": null},
  "quantity": {"value": null, "confidence": 0, "evidence": null},
  "length_mm": {"value": null, "confidence": 0, "evidence": null},
  "width_mm": {"value": null, "confidence": 0, "evidence": null},
  "thickness_mm": {"value": null, "confidence": 0, "evidence": null},
  "diameter_mm": {"value": null, "confidence": 0, "evidence": null},
  "drawing_weight_kg": {"value": null, "confidence": 0, "evidence": null},
  "units": {"value": "mm", "confidence": 0, "evidence": null},
  "tolerance": {"value": null, "confidence": 0, "evidence": null},
  "surface_finish": {"value": null, "confidence": 0, "evidence": null},
  "weld_details": {"value": null, "confidence": 0, "evidence": null},
  "hole_thread_details": {"value": null, "confidence": 0, "evidence": null},
  "heat_treatment": {"value": null, "confidence": 0, "evidence": null},
  "coating": {"value": null, "confidence": 0, "evidence": null},
  "manufacturing_processes": [
    {"sequence": 1, "operation": "Example operation", "work_center": "Example work center type", "reason": "Why this operation is required from the drawing", "confidence": 0.0}
  ],
  "notes": [],
  "warnings": []
}

Rules:
- Convert inch dimensions to mm only when the drawing explicitly states inches.
- If an overall L x W x T is explicit, map it carefully. Do not sort dimensions
  unless the drawing gives no orientation and you clearly note that ambiguity.
- Weight must be extracted only when explicitly stated as weight/mass.
- Capture explicit general tolerances, surface finish, weld notes, hole/thread callouts, heat treatment and coating when stated.
- After understanding the part, propose a practical manufacturing route in manufacturing_processes. Use only operations supported by visible geometry, notes, symbols or material requirements.
- Manufacturing route examples include raw material preparation, sawing, laser/plasma/waterjet cutting, punching, bending/forming, turning, milling, drilling, tapping, welding, grinding, deburring, polishing, heat treatment, coating/plating/painting, inspection and packing.
- Order processes in realistic shop-floor sequence. Do not add every possible process.
- Do not estimate setup time, cycle time, machine rate, labour rate or price. Those are estimator/master-rate decisions.
- If the drawing does not support a confident manufacturing route, return an empty manufacturing_processes array and add a warning.
- Evidence should be a short exact label/value reference from the drawing.
- Use confidence 0 to 1. Missing facts must have null value and confidence 0.
- Put ambiguity, conflicting dimensions, unreadable areas, or missing material in warnings.
""".strip()


def _json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


def _ai_evidence(raw: Any) -> Evidence:
    if not isinstance(raw, dict):
        return Evidence()
    value = raw.get("value")
    confidence = raw.get("confidence", 0)
    try:
        confidence = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence = 0.0
    return Evidence(
        value=value,
        source="drawing" if value is not None else "inferred",
        confidence=confidence,
        evidence=str(raw.get("evidence"))[:160] if raw.get("evidence") else None,
    )


def _to_extraction(parsed: dict[str, Any]) -> Extraction:
    result = Extraction()
    for name in FIELD_NAMES:
        setattr(result, name, _ai_evidence(parsed.get(name)))
    process_rows = parsed.get("manufacturing_processes", [])
    if isinstance(process_rows, list):
        cleaned: list[ProcessSuggestion] = []
        for index, row in enumerate(process_rows[:30], start=1):
            if not isinstance(row, dict) or not str(row.get("operation", "")).strip():
                continue
            try:
                confidence = max(0.0, min(1.0, float(row.get("confidence", 0))))
            except (TypeError, ValueError):
                confidence = 0.0
            cleaned.append(ProcessSuggestion(
                sequence=index,
                operation=str(row.get("operation", "")).strip()[:120],
                work_center=str(row.get("work_center", "")).strip()[:120] or None,
                reason=str(row.get("reason", "")).strip()[:300] or None,
                confidence=confidence,
            ))
        result.manufacturing_processes = cleaned
    result.notes = [str(v)[:300] for v in parsed.get("notes", []) if isinstance(v, str)][:50]
    result.warnings = [str(v)[:300] for v in parsed.get("warnings", []) if isinstance(v, str)][:50]
    return result


def _gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    return "".join(str(part.get("text", "")) for part in parts if part.get("text"))


def _gemini_extract(data: bytes, mime_type: str) -> Extraction | None:
    cfg = settings()
    if not cfg.gemini_api_key:
        return None

    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": PROMPT},
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": base64.b64encode(data).decode("ascii"),
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.0,
            "maxOutputTokens": 2200,
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{cfg.gemini_model}:generateContent"
    )
    with httpx.Client(timeout=cfg.ai_timeout_seconds) as client:
        response = client.post(
            url,
            headers={
                "x-goog-api-key": cfg.gemini_api_key,
                "content-type": "application/json",
            },
            json=body,
        )
        response.raise_for_status()
        parsed = _json_object(_gemini_text(response.json()))
    return _to_extraction(parsed)


def _openai_response_text(payload: dict[str, Any]) -> str:
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                return str(content["text"])
    return ""


def _openai_extract(data: bytes, filename: str) -> Extraction | None:
    cfg = settings()
    if not cfg.openai_api_key:
        return None

    encoded = base64.b64encode(data).decode("ascii")
    body = {
        "model": cfg.openai_model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": PROMPT},
                    {"type": "input_file", "filename": filename, "file_data": encoded},
                ],
            }
        ],
    }
    with httpx.Client(timeout=cfg.ai_timeout_seconds) as client:
        response = client.post(
            "https://api.openai.com/v1/responses",
            headers={
                "authorization": f"Bearer {cfg.openai_api_key}",
                "content-type": "application/json",
            },
            json=body,
        )
        response.raise_for_status()
        parsed = _json_object(_openai_response_text(response.json()))
    return _to_extraction(parsed)



def _gemini_extract_text(text: str, filename: str) -> Extraction | None:
    cfg = settings()
    if not cfg.gemini_api_key:
        return None

    context = text[:60_000]
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": f"{PROMPT}\n\nSOURCE FILE: {filename}\n\nEXTRACTED ENGINEERING TEXT:\n{context}"}
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.0,
            "maxOutputTokens": 2200,
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{cfg.gemini_model}:generateContent"
    )
    with httpx.Client(timeout=cfg.ai_timeout_seconds) as client:
        response = client.post(
            url,
            headers={
                "x-goog-api-key": cfg.gemini_api_key,
                "content-type": "application/json",
            },
            json=body,
        )
        response.raise_for_status()
        parsed = _json_object(_gemini_text(response.json()))
    return _to_extraction(parsed)


def _openai_extract_text(text: str, filename: str) -> Extraction | None:
    cfg = settings()
    if not cfg.openai_api_key:
        return None

    body = {
        "model": cfg.openai_model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": f"{PROMPT}\n\nSOURCE FILE: {filename}\n\nEXTRACTED ENGINEERING TEXT:\n{text[:60_000]}",
                    }
                ],
            }
        ],
    }
    with httpx.Client(timeout=cfg.ai_timeout_seconds) as client:
        response = client.post(
            "https://api.openai.com/v1/responses",
            headers={
                "authorization": f"Bearer {cfg.openai_api_key}",
                "content-type": "application/json",
            },
            json=body,
        )
        response.raise_for_status()
        parsed = _json_object(_openai_response_text(response.json()))
    return _to_extraction(parsed)

def ai_extract(data: bytes, mime_type: str, filename: str) -> Extraction | None:
    provider = settings().ai_provider.strip().lower()
    if provider == "none":
        return None
    if provider == "gemini":
        return _gemini_extract(data, mime_type)
    if provider == "openai":
        return _openai_extract(data, filename)
    raise ValueError(f"Unsupported AI_PROVIDER: {provider}")



def ai_extract_text(text: str, filename: str) -> Extraction | None:
    provider = settings().ai_provider.strip().lower()
    if provider == "none":
        return None
    if provider == "gemini":
        return _gemini_extract_text(text, filename)
    if provider == "openai":
        return _openai_extract_text(text, filename)
    raise ValueError(f"Unsupported AI_PROVIDER: {provider}")

def merge_extractions(local: Extraction, ai: Extraction | None) -> Extraction:
    if ai is None:
        return local

    merged = local.model_copy(deep=True)
    for name in FIELD_NAMES:
        local_value: Evidence = getattr(local, name)
        ai_value: Evidence = getattr(ai, name)
        if local_value.value is None and ai_value.value is not None:
            setattr(merged, name, ai_value)
        elif (
            ai_value.value is not None
            and ai_value.confidence > local_value.confidence + 0.12
            and local_value.confidence < 0.86
        ):
            setattr(merged, name, ai_value)

    merged.manufacturing_processes = ai.manufacturing_processes
    merged.notes = list(dict.fromkeys(local.notes + ai.notes))[:100]
    merged.warnings = list(dict.fromkeys(local.warnings + ai.warnings))[:100]
    return merged
