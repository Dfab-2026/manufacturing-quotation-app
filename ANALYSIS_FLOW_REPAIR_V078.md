# v0.7.8 — Original UI, Analyze / Review stability repair

Base: original-ui-v0.7.7. No UI redesign, database migration, price master change or quotation calculation change.

## Changes
- Analysis requests now have an explicit 120-second client timeout instead of 45 seconds. Status-specific API errors tell users about an unavailable FastAPI backend, timeouts, Gemini quota, or invalid uploads; raw HTML/error traces are not shown.
- Removed fabricated `analyze-fallback` results from the drawing-analysis UI. If Gemini analysis fails, the source is marked failed and retry remains available. Never issue a quotation from imaginary extracted values.
- Retry only one transient gateway/service error; quota exhausted and validation errors are not retried. Each source's failed message is visible to the estimator.
- Removed a redundant network quotation calculation after a successful analysis; the backend response already contains the summary.
- Validated the analyze response shape before opening Drawing Review and explicitly opened the workflow view/Step 2 on success.
- Added backend PDF/image upload type and 30 MB size validation. Standardized 429/503/502 image extraction error handling.
- Noncritical extraction history capture errors no longer discard successful drawing extraction. DFM/BOM are independently guarded so failure in either cannot discard extracted fields; the unchanged review flow can separately generate reports.
- Existing original UI, Save Review & Continue mechanics, manufacturing masters, quotation calculations, rates and PDF export preserved.

## Run
Backend: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`
Frontend: `cd frontend && npm install && npm run dev`
Configure `backend/.env` with GEMINI_API_KEY and GEMINI_MODEL, and frontend/.env.local with NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000. Never place Gemini keys in frontend variables.

## Verification limitations
- Python source compilation: passed.
- Existing focused weight tests: 4 passed.
- TypeScript parse check of changed source: passed.
- Full Next.js build/typecheck and live Gemini/database E2E were not possible in the current environment; validate these in the target environment before using commercially.
- No code can bypass an exhausted Gemini API quota; that requires quota/billing resolution.
