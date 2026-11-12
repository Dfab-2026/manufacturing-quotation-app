# Drawing review → engineering and DFM/BOM report fix

This is a targeted patch on top of the **original manufacturing-quotation-app-main UI**. No theme, layout, rate master, quotation formulas, extraction engine, or database migrations were modified.

## Changed

- The required `/api/review` save runs first. Once it succeeds, **Save Review & Continue** advances to the existing Step 3 Engineering & Cost Sheet.
- `/api/revisions` history is best effort and no longer blocks advancing if revision persistence fails. Failures are logged and reported.
- Reviewed DFM and BOM are requested **concurrently**, using the latest confirmed drawing, rows, and AI data. Both are independently persisted in the existing report state/history. Failure of either does not cancel the other.
- DFM and BOM headers no longer incorrectly say “ready” when generation failed or when no report exists.
- If the primary review save fails, the user stays on Step 2 with an actionable message. No fake save-success is shown.

## Startup (unchanged)

In `frontend` run `npm install && npm run dev`. In `backend`, configure `DATABASE_URL` and `GEMINI_API_KEY`, install `requirements.txt` and start `uvicorn app.main:app --reload --port 8000`.

## Validation and limits

- Frontend TypeScript/TSX parser: PASS (no syntax errors).
- Backend Python compile: PASS.
- Full Next.js production build: NOT VERIFIED (`next` dependencies are not installed in this environment; `npm run build` reports `next: not found`).
- Live PostgreSQL / Gemini integration: NOT TESTED (no credentials or accessible database provided).
- **Important:** DFM and BOM are engineering assistance reports; the estimator must review unknowns before quotation release. A failed report is marked failed, not ready.
