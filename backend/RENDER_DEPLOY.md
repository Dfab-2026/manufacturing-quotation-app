# Production FastAPI deployment (Render)

This repository deploys the FastAPI service separately from the Next.js frontend.
The Render Blueprint is `../render.yaml` and creates the service `ai-quotation-api`.

## Render service settings

- Runtime: Python
- Root directory: `backend`
- Build command: `python -m pip install --upgrade pip && pip install -r requirements-render.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check: `/api/health`
- Python: `3.12.10`

Set these environment variables on the Render service:

- `DATABASE_URL`: Supabase PostgreSQL Transaction Pooler connection string, preferably port `6543`, with `sslmode=require`. This is required for durable quotations, workspace metadata, and original uploaded STEP/PDF/image files.
- `FRONTEND_ORIGIN`: optional comma-separated frontend origins. Vercel `*.vercel.app` origins and localhost development origins are already allowed by the API.
- `MAX_UPLOAD_MB=100`
- `LOCAL_OCR_ENABLED=true` (required for high-resolution reading of scanned or tiny drawing callouts). The production requirements now include RapidOCR and ONNX Runtime. Set `DETAIL_OCR_DPI=400`, `DETAIL_OCR_SECONDS=100`, `DETAIL_OCR_MAX_PAGES=30`, and `DETAIL_OCR_MAX_TILES=160` if overriding defaults. Render must have adequate RAM/CPU for ONNX and CAD processing.

After deployment, open `https://ai-quotation-api.onrender.com/api/health`.
Confirm that the JSON contains:

```json
{
  "status": "ok",
  "database": "connected",
  "database_configured": true,
  "persistent_storage": "postgresql"
}
```

If `database_configured` is false, the service is running without a durable database. In-memory fallback is suitable only for temporary local/test use; it loses saved data when the process restarts.

## Vercel frontend settings

Set the Vercel project Root Directory to `frontend`, Framework Preset to Next.js, and configure:

- `NEXT_PUBLIC_API_BASE_URL=https://ai-quotation-api.onrender.com`
- `NEXT_PUBLIC_FASTAPI_URL=https://ai-quotation-api.onrender.com`
- `FASTAPI_INTERNAL_URL=https://ai-quotation-api.onrender.com`

Redeploy the backend first, then redeploy the Vercel frontend. The frontend build has a local Three.js declaration shim so a missing optional `@types/three` package does not block the production type-check.
