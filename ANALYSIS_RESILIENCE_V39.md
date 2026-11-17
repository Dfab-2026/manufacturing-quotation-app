# V39 analysis resilience fix

Targeted fixes only; all unrelated working UI/flows remain locked.

## Fixed production errors
- `drawings.id` compatibility: legacy Supabase UUID schemas now receive a deterministic UUID5 key instead of a 64-character SHA-256 string.
- `/api/analyze-cad`: removed undefined `chamfers`, `bends`, and `welds` references.
- CAD/fallback analysis no longer generates DFM/BOM synchronously; the existing frontend background artifact flow remains responsible for those reports.

## All-source recovery behavior
- PDF: local PyPDF/PyMuPDF engineering parser first, Gemini recovery when configured, optional local RapidOCR when enabled/installed.
- Images: optional local OCR, then Gemini visual recovery; if neither resolves mandatory fields, returns editable predicted/review-required fields.
- DXF: ezdxf geometry extraction; incomplete fields remain editable and are marked review-required.
- DWG/other drawing binaries: safe generic extraction/fallback without 500 errors.
- STEP/STP/IGES/IGS/STL/OBJ/GLB/GLTF/X_T/X_B: browser CAD geometry path; browser/parser or backend failure falls back to an editable predicted/review-required result.

## Prediction policy
Successful extracted values are preserved. Missing/unreadable values are not silently treated as exact. The response is marked `predicted_review_required`, includes editable placeholder dimensions, and carries review-required notes before quotation release.

## Verification
- Python compile: PASS
- Backend pytest: 7 passed
- `/api/analyze-fallback` DWG smoke test: HTTP 200
- `/api/analyze-cad` STEP smoke test: HTTP 200
- PDF analyze smoke test: HTTP 200
- Image analyze without local OCR: HTTP 200 with predicted/review-required fallback
- Generic DWG binary analyze: HTTP 200 with predicted/review-required fallback
- Frontend `page.tsx` and `api.ts` TypeScript syntax transpilation: PASS
- Full Next production build not claimed because dependency installation exceeded the execution window.
