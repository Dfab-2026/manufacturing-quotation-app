from __future__ import annotations

import importlib
import json
import sys

REQUIRED = {
    "fastapi": "FastAPI",
    "uvicorn": "Uvicorn",
    "pymupdf": "PyMuPDF",
    "pypdf": "PyPDF",
    "ezdxf": "DXF parser",
    "numpy": "NumPy",
    "onnxruntime": "ONNX Runtime",
    "rapidocr": "RapidOCR",
    "PIL": "Pillow",
    "sqlalchemy": "SQLAlchemy",
    "psycopg": "PostgreSQL driver",
    "openpyxl": "Excel",
    "reportlab": "PDF output",
}

status: dict[str, str] = {}
for module, label in REQUIRED.items():
    try:
        importlib.import_module(module)
        status[label] = "OK"
    except Exception as exc:
        status[label] = f"ERROR: {exc}"

try:
    from rapidocr import RapidOCR

    RapidOCR()
    status["RapidOCR engine initialization"] = "OK"
except Exception as exc:
    status["RapidOCR engine initialization"] = f"ERROR: {exc}"

print(json.dumps(status, indent=2))
failed = [name for name, value in status.items() if not value.startswith("OK")]
if failed:
    print("\nExtraction environment has problems:", ", ".join(failed))
    sys.exit(1)

print("\nALL EXTRACTION ENGINES READY")
