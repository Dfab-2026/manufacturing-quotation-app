# v0.7.6 — Original UI targeted fix

No visual design, navigation, costing, Rate Master, quotations, data schemas or other working features were changed.

## Drawing Review → Save Review & Continue
- The reviewed drawing, edited costing rows, and Step 3 position are persisted to the existing IndexedDB draft/dataset stores before navigating.
- The backend `/api/review` sync starts immediately but does not hold the screen at Step 2 when browser persistence has succeeded.
- If browser persistence is blocked, backend save must succeed before continuing.
- A failed backend sync is reported explicitly. A browser-only save does NOT mean the review is in the company database. Check backend database connectivity before final production release.
- Existing DFM and BOM generation remains independent and concurrent after review.
- Existing revision history remains non-blocking.

## Analysis speed
- Searchable text-based PDFs with no visible weight/mass callout no longer trigger an unnecessary second Gemini vision request to confirm the absence of a printed weight.
- Scanned PDFs, title blocks with printed weight callouts, and model-provided weight without evidence retain the focused weight-verification pass.
- Gemini quota or model inference latency cannot be eliminated by this change.

## Run
- Frontend: `cd frontend && npm install && npm run dev`
- Backend: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`
- Set `backend/.env` with a valid PostgreSQL `DATABASE_URL`, `GEMINI_API_KEY`, and model, and frontend `.env.local` with `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` as required.

## Validation
- Python compilation: passed
- Focused extra Gemini-call decision: 4/4 unit tests passed
- TSX parser: passed
- Full Next.js build: NOT run successfully; npm dependency installation timed out in this environment
- Live database/Gemini E2E: not verified without user credentials
