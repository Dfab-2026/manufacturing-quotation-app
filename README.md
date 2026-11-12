# Manufacturing Quotation App

Production architecture: Next.js frontend + FastAPI backend + PostgreSQL. FastAPI owns drawing analysis, review persistence, costing, rate master, workspaces, DFM/BOM, dataset, revisions, premium estimate, quotations and exports.

## Backend
1. `cd backend`
2. `python -m venv .venv`
3. Windows: `.\.venv\Scripts\Activate.ps1`
4. `pip install -r requirements.txt`
5. Copy `.env.example` to `.env` and fill `DATABASE_URL` and `FRONTEND_ORIGIN`. No AI API key is required for local PDF/DXF extraction.
6. `uvicorn app.main:app --host 0.0.0.0 --port 8000`
7. Verify `http://127.0.0.1:8000/api/health`.

## Frontend
1. `cd frontend`
2. `npm ci`
3. Copy `.env.local.example` to `.env.local`.
4. Set `NEXT_PUBLIC_API_BASE_URL` to the FastAPI URL.
5. `npm run build`
6. `npm run start`

## Production
Deploy the frontend to Vercel and the FastAPI backend to Render/Railway/Fly.io or another Python ASGI host. Set `FRONTEND_ORIGIN` on the backend to the exact frontend URL and set `NEXT_PUBLIC_API_BASE_URL` on the frontend to the exact backend URL.


## Existing database compatibility
On backend startup the app applies additive schema compatibility updates for older `drawings` tables. Existing rows are preserved; no tables are dropped. Drawing extraction now runs locally in FastAPI using PyPDF/PyMuPDF and deterministic engineering parsing; Gemini is not required.

## Free local extraction

The normal `/api/analyze` flow is fully local/free. FastAPI uses the embedded PDF text layer first, then RapidOCR (ONNX Runtime) for scanned/image title blocks when critical values are missing. No Gemini/OpenAI key is required.

The frontend defaults to `/backend-api`, which Next.js proxies to `FASTAPI_INTERNAL_URL` (default `http://127.0.0.1:8000`). This avoids browser CORS and hard-coded port failures. After changing `.env.local`, restart the Next.js dev server.

## FastAPI Extraction Pipeline v13

The production analysis route is `POST /api/analyze` and does not require Gemini or another paid AI API.

Fast path for vector PDFs:
1. PyPDF and PyMuPDF text extraction run concurrently.
2. Deterministic engineering parsers normalize title-block data, material grades, thickness, printed weight, dimensions/tolerances, holes/slots, threads, chamfers, bends, studs, welds, finishes and process callouts.
3. Geometry-based weight is used only when a drawing-stated weight is not available and the geometry/material evidence is sufficient.
4. Rate Master builds editable costing rows.
5. DFM/BOM are returned in the same response.
6. Extraction history is persisted as a FastAPI background task so database latency does not block the Analyze result.

Scanned/image drawings use local RapidOCR/ONNX only when needed. Clean vector PDFs do not run full-page OCR.

Diagnostic endpoint: `GET /api/extraction/capabilities`.
