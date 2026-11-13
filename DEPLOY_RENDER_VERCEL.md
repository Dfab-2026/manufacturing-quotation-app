# Production deployment: Render backend + Vercel frontend

## 1. Deploy backend first on Render
- New > Web Service > connect GitHub repository.
- Root Directory: `backend`
- Runtime: Python
- Build Command: `python -m pip install --upgrade pip && pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/api/health`

Backend environment variables:
- `DATABASE_URL` = Supabase/PostgreSQL connection string (Supabase Transaction Pooler recommended)
- `FRONTEND_ORIGIN` = `http://localhost:3000` temporarily, then replace/add the final Vercel URL
- `LOCAL_OCR_ENABLED=true`
- `MAX_UPLOAD_MB=100`
- `DB_POOL_SIZE=3`
- `DB_MAX_OVERFLOW=2`
- Optional: `GEMINI_API_KEY`, `GEMINI_MODEL`

Verify before deploying the frontend:
- `https://<render-service>/api/health`
- `https://<render-service>/docs`
- Upload a real file to `POST /api/analyze` in Swagger and confirm HTTP 200.

## 2. Deploy frontend second on Vercel
- Import the same GitHub repository.
- Root Directory: `frontend`
- Framework: Next.js
- Keep default install/build/output settings.

Frontend environment variables (replace with the Render URL):
- `NEXT_PUBLIC_API_BASE_URL=https://<render-service>`
- `NEXT_PUBLIC_FASTAPI_URL=https://<render-service>`
- `FASTAPI_INTERNAL_URL=https://<render-service>`

Deploy, then update Render `FRONTEND_ORIGIN` to include the exact Vercel frontend URL and redeploy/restart Render if needed.

## 3. Final production smoke test
1. Open Vercel frontend.
2. Upload one PDF.
3. Analyze -> Step 2.
4. Confirm drawing/material/geometry/weight/features.
5. Save Review & Continue.
6. Confirm Cost Sheet.
7. Continue to Quotation and save/download.
8. Confirm history and Rate Master persistence.
