"""Verify the slim Vercel production runtime.

RapidOCR/ONNX are intentionally optional in production. They remain available
through requirements-local-ocr.txt for local/desktop use.
"""
from __future__ import annotations

import importlib
import importlib.util
import os
import sys

REQUIRED = {
    "fastapi": "FastAPI",
    "multipart": "python-multipart",
    "sqlalchemy": "SQLAlchemy",
    "pypdf": "PyPDF",
    "pymupdf": "PyMuPDF",
    "PIL": "Pillow",
    "ezdxf": "ezdxf",
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


raw_db = os.getenv("DATABASE_URL", "").strip().lower()
if raw_db.startswith(("postgresql://", "postgres://", "postgresql+psycopg://")):
    try:
        importlib.import_module("psycopg")
        print("[OK] psycopg")
    except Exception as exc:
        failed.append(("psycopg", str(exc)))
        print(f"[FAIL] psycopg: {exc}")
else:
    print("[OPTIONAL] psycopg: required when PostgreSQL DATABASE_URL is configured")

for module, label in (("rapidocr", "RapidOCR"), ("onnxruntime", "ONNX Runtime")):
    print(f"[OPTIONAL] {label}: {'installed' if importlib.util.find_spec(module) else 'not bundled in slim production'}")

print(f"[OPTIONAL] Gemini visual fallback: {'configured' if os.getenv('GEMINI_API_KEY') else 'not configured'}")

if failed:
    print("\nProduction runtime verification failed.")
    sys.exit(1)

print("\nSlim production extraction runtime is ready.")
