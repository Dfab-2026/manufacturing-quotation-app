# Production deployment: Render backend + Vercel frontend

## 1. Deploy backend first on Render

Use the Render Blueprint in `render.yaml` (service name `ai-quotation-api`) or create a Web Service with the settings in `backend/RENDER_DEPLOY.md`.
- New > Web Service > connect GitHub repository.
- Root Directory: `backend`
- Runtime: Python
- Build Command: `python -m pip install --upgrade pip && pip install -r requirements-render.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/api/health`

Backend environment variables (DATABASE_URL is required for durable history and source-file persistence):
- `DATABASE_URL` = Supabase/PostgreSQL connection string (Supabase Transaction Pooler recommended)
- `FRONTEND_ORIGIN` = optional comma-separated origins (the API already permits localhost and Vercel preview domains)
- `LOCAL_OCR_ENABLED=false`
- `MAX_UPLOAD_MB=100`
- `DB_POOL_SIZE=3`
- `DB_MAX_OVERFLOW=2`
- Optional: `GEMINI_API_KEY`, `GEMINI_MODEL`

Verify before deploying the frontend:
- `https://ai-quotation-api.onrender.com/api/health`
- `https://ai-quotation-api.onrender.com/docs`
- Upload a real file to `POST /api/analyze` in Swagger and confirm HTTP 200.

## 2. Deploy frontend second on Vercel
- Import the same GitHub repository.
- Root Directory: `frontend`
- Framework: Next.js
- Install Command: `npm run release:install` (defined in `frontend/vercel.json`).
- Build Command: `npm run release:check` (defined in `frontend/vercel.json`).
- Output Directory: leave unset; Vercel handles the Next.js output.
- Node.js Version: `22.x` (also specified in `frontend/package.json`).
- Confirm **Root Directory = `frontend` in the Vercel project dashboard**; the repository JSON cannot set this.
- **Before deploying v92 or later:** run `npm run release:prepare` locally from `frontend` with an accessible npm registry and commit both `frontend/package.json` and `frontend/package-lock.json`. The original v92 lockfile still has Next.js 14 / React 18 and intentionally fails the release gate. Never regenerate it during a Vercel build.

Frontend environment variables (set for the intended Vercel environments; replace with your actual Render origin, without an `/api` suffix):
- `NEXT_PUBLIC_API_BASE_URL=https://ai-quotation-api.onrender.com`
- `NEXT_PUBLIC_FASTAPI_URL=https://ai-quotation-api.onrender.com`
- `FASTAPI_INTERNAL_URL=https://ai-quotation-api.onrender.com`

`NEXT_PUBLIC_API_BASE_URL` is the browser's primary direct FastAPI URL; `NEXT_PUBLIC_FASTAPI_URL` is the existing alternative; `FASTAPI_INTERNAL_URL` is only for the Next.js `/backend-api` rewrite. On production domains, the browser defaults to `https://ai-quotation-api.onrender.com` if no public URL is set. Do not set these variables to `localhost` or expose database secrets. Redeploy after changing any `NEXT_PUBLIC_` value because Next.js bakes it into the frontend bundle.

Deploy the backend first, then deploy the frontend. If using a custom non-Vercel domain, add it to Render `FRONTEND_ORIGIN`. Check Vercel deployment logs for the **first** `[release FAILED n/8]` stage: a passing test stage is not proof the later audit/build/typecheck passed. See `VERCEL_DEPLOYMENT_AUDIT_V93.md` for the v92 audit and remediation.

## 3. Final production smoke test
1. Open Vercel frontend.
2. Upload one PDF.
3. Analyze -> Step 2.
4. Confirm drawing/material/geometry/weight/features.
5. Save Review & Continue.
6. Confirm Cost Sheet.
7. Continue to Quotation and save/download.
8. Confirm history and Rate Master persistence.
