"""Verify the backend production drawing extraction runtime."""
from __future__ import annotations

import importlib
import importlib.util
import os
import sys
import shutil

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

if os.getenv("LOCAL_OCR_ENABLED", "true").lower() in {"true", "1", "yes", "on"}:
    if shutil.which("tesseract"):
        print("[OK] Tesseract optical reader")
    else:
        for module, label in (("rapidocr", "RapidOCR"), ("onnxruntime", "ONNX Runtime")):
            try:
                importlib.import_module(module)
                print(f"[OK] {label}")
            except Exception as exc:
                failed.append((label,str(exc)))
                print(f"[FAIL] {label}: {exc}")

print(f"[OPTIONAL] Gemini visual fallback: {'configured' if os.getenv('GEMINI_API_KEY') else 'not configured'}")

if failed:
    print("\nProduction runtime verification failed.")
    sys.exit(1)

print("\nSlim production extraction runtime is ready.")
