# Production deployment — slim Vercel backend

This build is intentionally split into two dependency profiles.

## Vercel production

Vercel installs `backend/pyproject.toml`. It contains only the runtime packages
needed for FastAPI, PDF/DXF parsing, database access, Excel/PDF export and the
local deterministic engineering parser.

RapidOCR, ONNX Runtime and NumPy are intentionally excluded from the Vercel
bundle because they pushed the previous function above the 500 MB standard
Python bundle limit.

Production extraction order:
1. PyPDF + PyMuPDF + deterministic engineering rules.
2. DXF geometry parser for DXF.
3. If mandatory fields/features are incomplete and `GEMINI_API_KEY` is set,
   FastAPI uses the server-side Gemini fallback.
4. Existing geometry/material weight calculations and Rate Master logic.

Recommended backend Vercel environment variables:

- `DATABASE_URL`
- `FRONTEND_ORIGIN`
- `GEMINI_API_KEY` — recommended for scanned/image-only drawings
- `GEMINI_MODEL=gemini-3.5-flash-lite`
- `MAX_UPLOAD_MB=100`
- `DB_POOL_SIZE=1`
- `DB_MAX_OVERFLOW=0`

After deployment test:

- `/api/health`
- `/api/analyze`

`/api/health` should report the core PDF/DXF extraction dependencies as ready.
`local_ocr` will report `optional_not_bundled` on the slim Vercel deployment;
that is expected, not an error.

## Local Windows/full OCR

Local development still uses:

`python -m pip install -r requirements.txt`

That file installs `requirements-local-ocr.txt`, which includes:

- RapidOCR
- ONNX Runtime
- NumPy
- Uvicorn standard extras

So your local machine keeps the full OCR path that already worked in terminal.
