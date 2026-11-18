# CAD analysis routing fix

Targeted update only. Existing UI, quotation flow, history/draft behavior, costing and unrelated code are unchanged.

## Fix
- CAD analysis (`/api/analyze-cad`) now uses the same production routing strategy as PDF analysis: direct FastAPI first, Next.js proxy fallback.
- CAD fallback analysis (`/api/analyze-fallback`) uses the same resilient routing.
- This fixes deployed STEP/STP/IGES/STL/OBJ and other accepted model sources failing when the frontend proxy cannot reach `FASTAPI_INTERNAL_URL`.

## Verification
- Backend resilient-analysis tests: 3 passed.
- Frontend build/typecheck could not be executed in this sandbox because dependency installation did not complete; no UI code or dependencies were changed.
