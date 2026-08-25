v0.6.5 Vercel Backend Deployment Patch

WHY PRODUCTION DID NOT WORK
===========================
The existing Vercel project has Root Directory = frontend, so only Next.js
was deployed. The frontend API client falls back to http://127.0.0.1:8000
unless NEXT_PUBLIC_API_BASE_URL is set.

THIS PATCH ADDS
===============
- backend/api/index.py for Vercel FastAPI discovery
- production CORS via FRONTEND_ORIGIN
- GEMINI_MODEL environment variable
- default GEMINI_MODEL=gemini-3.5-flash-lite
- v0.6.4 PyMuPDF import fix retained
- Neon PostgreSQL retained

DEPLOY BACKEND AS SECOND VERCEL PROJECT
=======================================
Repository:
Dfab-2026/manufacturing-quotation-app

Backend Vercel project:
Root Directory: backend
Framework Preset: Other
Build / Output / Install overrides: OFF

Environment variables on BACKEND project:
DATABASE_URL=<Neon DATABASE_URL>
GEMINI_API_KEY=<Gemini key>
GEMINI_MODEL=gemini-3.5-flash-lite
FRONTEND_ORIGIN=https://dfab-quotation-db.vercel.app

After backend deployment:
Open:
https://YOUR-BACKEND-PROJECT.vercel.app/api/health

Expected:
{"status":"ok","version":"0.6.5","database":"connected"}

FRONTEND PROJECT ENV
====================
On the existing frontend Vercel project add:

NEXT_PUBLIC_API_BASE_URL=https://YOUR-BACKEND-PROJECT.vercel.app

Apply to Production and Preview, then redeploy the frontend.
Do not put DATABASE_URL or GEMINI_API_KEY in NEXT_PUBLIC variables.
