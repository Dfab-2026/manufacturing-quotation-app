# Production deployment

## Backend Vercel project

- Root Directory: `backend`
- Preset: FastAPI
- Python: 3.12
- `pyproject.toml` and `requirements.txt` contain the same runtime dependencies, including RapidOCR and ONNX Runtime.
- `backend/vercel.json` sets the FastAPI function duration to 300 seconds.

Required environment variables:

```env
DATABASE_URL=postgresql+psycopg://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:6543/postgres?sslmode=require
FRONTEND_ORIGIN=https://YOUR-FRONTEND.vercel.app
MAX_UPLOAD_MB=100
DB_POOL_SIZE=1
DB_MAX_OVERFLOW=0
```

Verify after deploy:

- `/` returns service status
- `/api/health` reports `rapidocr: true` and `onnxruntime: true`
- `/docs` opens FastAPI docs

## Frontend Vercel project

- Root Directory: `frontend`
- Preset: Next.js

Environment variables:

```env
NEXT_PUBLIC_API_BASE_URL=/backend-api
FASTAPI_INTERNAL_URL=https://YOUR-BACKEND.vercel.app
NEXT_PUBLIC_FASTAPI_URL=https://YOUR-BACKEND.vercel.app
```

Redeploy the backend first, verify `/api/health`, then redeploy the frontend.
