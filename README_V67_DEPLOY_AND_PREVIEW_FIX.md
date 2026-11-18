# v67 – Vercel build, Render backend and History preview persistence

## Targeted changes

- Added a TypeScript declaration shim for the existing Three.js runtime import so the Vercel type-check no longer stops at `Could not find a declaration file for module 'three'`.
- Added backend workspace session/file API client functions.
- Original STEP/STP/PDF/image files are uploaded to the backend workspace file store and associated with the quotation's History IDs. Draft continuation can download and reconstruct those `File` objects if the browser's local IndexedDB snapshot is missing.
- New Quotation and End Process keep the workspace session/file blobs for saved Drafts; they are no longer deleted while History still needs the preview.
- History Continue and the Ongoing diamond share the same local/remote preview restore path.
- Render service name, production API fallback, Vercel rewrite fallback and deployment documentation now consistently use `ai-quotation-api.onrender.com`.
- Health output explicitly reports whether PostgreSQL is configured and whether persistence is durable.

## Local development

Frontend `.env.local` should use the local API values from `frontend/.env.local.example`.

Backend terminal:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production deployment

1. Push this project version to the GitHub branch connected to Render/Vercel.
2. Deploy the Render Blueprint from `render.yaml` (service `ai-quotation-api`, root directory `backend`).
3. Set `DATABASE_URL` on Render to the Supabase PostgreSQL Transaction Pooler URL. Without this, the health endpoint reports `persistent_storage: ephemeral_or_unavailable`, and backend workspace files/history are not durable across restarts.
4. Verify `https://ai-quotation-api.onrender.com/api/health` reports `database_configured: true`, `database: connected`, and `persistent_storage: postgresql`.
5. In Vercel set Root Directory `frontend` and these environment variables:

```text
NEXT_PUBLIC_API_BASE_URL=https://ai-quotation-api.onrender.com
NEXT_PUBLIC_FASTAPI_URL=https://ai-quotation-api.onrender.com
FASTAPI_INTERNAL_URL=https://ai-quotation-api.onrender.com
```

6. Redeploy Vercel after the Render backend is healthy.

## Validation performed in this build environment

- Backend Python compile: passed.
- Backend pytest: 18 passed.
- Frontend TypeScript/TSX syntax transpilation: passed.
- Three.js ambient declaration import check: passed.
- Next.js production build: not run successfully in this environment because `npm ci` could not complete and the local `next` executable was unavailable. Vercel should run the full build from a fresh install after this update.
