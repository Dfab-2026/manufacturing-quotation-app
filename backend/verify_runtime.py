"""Production dependency verification. Run before deployment or from CI."""
from __future__ import annotations

import importlib
import sys

REQUIRED = {
    "fastapi": "FastAPI",
    "uvicorn": "Uvicorn",
    "multipart": "python-multipart",
    "sqlalchemy": "SQLAlchemy",
    "psycopg": "psycopg",
    "pypdf": "PyPDF",
    "pymupdf": "PyMuPDF",
    "PIL": "Pillow",
    "ezdxf": "ezdxf",
    "numpy": "NumPy",
    "rapidocr": "RapidOCR",
    "onnxruntime": "ONNX Runtime",
    "openpyxl": "OpenPyXL",
    "reportlab": "ReportLab",
}

failed = []
for module, label in REQUIRED.items():
    try:
        importlib.import_module(module)
        print(f"[OK] {label}")
    except Exception as exc:
        failed.append((label, str(exc)))
        print(f"[FAIL] {label}: {exc}")

if failed:
    print("\nProduction runtime verification failed.")
    sys.exit(1)

print("\nAll production extraction dependencies are available.")
