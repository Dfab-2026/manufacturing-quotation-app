# Production deployment (Vercel frontend + Vercel FastAPI backend)

## Backend project
- Root Directory: `backend`
- Preset: FastAPI
- Python: 3.12
- Uses `backend/pyproject.toml` (slim production dependencies)
- Native Vercel FastAPI entrypoint: `app.main:app`
- No rewrite layer is required.

Backend environment variables:

```env
DATABASE_URL=postgresql+psycopg://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@POOLER_HOST:6543/postgres?sslmode=require
FRONTEND_ORIGIN=https://YOUR-FRONTEND.vercel.app
MAX_UPLOAD_MB=100
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
LOCAL_OCR_ENABLED=false
```

The backend starts and `/api/analyze` remains usable even if the database is temporarily unavailable. Database persistence is best-effort on the extraction critical path.

After deployment, verify:
- `/api/health` -> HTTP 200
- `/api/analyze` -> upload a PDF and expect HTTP 200

## Frontend project
- Root Directory: `frontend`
- Preset: Next.js

Frontend environment variables:

```env
NEXT_PUBLIC_API_BASE_URL=/backend-api
FASTAPI_INTERNAL_URL=https://YOUR-BACKEND.vercel.app
NEXT_PUBLIC_FASTAPI_URL=https://YOUR-BACKEND.vercel.app
```

## Local full OCR
For local desktop use, install `backend/requirements.txt` and set:

```env
LOCAL_OCR_ENABLED=true
```

RapidOCR/ONNX remain local-only to keep the standard Vercel Python function below its bundle limit.
