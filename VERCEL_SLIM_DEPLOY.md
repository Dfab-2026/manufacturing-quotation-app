# Vercel slim backend deployment

The Vercel backend intentionally does **not** bundle RapidOCR/ONNX Runtime.
Those two packages are the main reason the previous Python function exceeded
Vercel's standard uncompressed bundle limit.

Production extraction order:
1. PyPDF / PyMuPDF / DXF deterministic extraction.
2. If mandatory engineering fields are incomplete and `GEMINI_API_KEY` is set,
   FastAPI calls the server-side Gemini fallback.
3. RapidOCR remains available for local Windows use through
   `requirements-local-ocr.txt` and is used automatically when installed.

Backend Vercel environment variables:
- `DATABASE_URL`
- `FRONTEND_ORIGIN`
- `GEMINI_API_KEY` (recommended for scanned/visually encoded drawings)
- `GEMINI_MODEL=gemini-3.5-flash-lite`
- `MAX_UPLOAD_MB=100`
- `DB_POOL_SIZE=1`
- `DB_MAX_OVERFLOW=0`

Local install:
`python -m pip install -r requirements.txt`

Production Vercel installs the slim dependency list from `pyproject.toml`.
