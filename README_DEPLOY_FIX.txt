v0.6.6 Vercel routing fix

This patch fixes Vercel 404 NOT_FOUND for the backend project by adding:

1. backend/vercel.json
   - explicitly rewrites /api/* to /api/index.py
   - gives the Python function a 60 second max duration

2. backend/api/index.py
   - inserts backend root into sys.path before importing app.main
   - exposes the FastAPI app as module-level `app`

3. backend/pyproject.toml
   - explicitly declares the Python project and dependencies for Vercel

4. GET /
   - simple backend root check

VERCEL SETTINGS
===============
Project: dfab-quotation-api
Root Directory: backend
Framework Preset: Other
Build Command: Override OFF
Output Directory: Override OFF
Install Command: Override OFF

Environment variables:
DATABASE_URL
GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
FRONTEND_ORIGIN=https://dfab-quotation-db.vercel.app

After replacing files:
git add backend
git commit -m "Fix Vercel FastAPI routing"
git push

Then redeploy the backend project.

Test:
https://dfab-quotation-api.vercel.app/
https://dfab-quotation-api.vercel.app/api/health
