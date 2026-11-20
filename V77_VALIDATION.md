# V77 — targeted drawing Locate and thickness repair

Base: the supplied V76 release. No intentional changes to unrelated pages, navigation, Rate Masters, database schema, deployment configuration, draft/history, BOM or quotation workflow.

## Changes
- Cost Sheet Locate selects the matching drawing page and scrolls to the original preview. It displays a persistent red dot inside a blinking ring; repeat clicks restart the animation. CAD Locate uses the existing 3D marker renderer with measured source points.
- Weight uses Locate (not Calculation). Printed weights locate their actual annotations. Geometry-derived weights locate the available input dimensions or CAD geometry; these are identified as derived evidence, not printed weight annotations.
- Recovered source evidence is attached to the current analysis/workspace. The request checks the original drawing SHA-256 when available, preventing new coordinates from being assigned to a different drawing.
- Thickness recovery supports explicit decimal, fractional/imperial, separated label/value, stock plate, rectangular tube, and round tube wall callouts; unique OD and ID; and single-solid CAD plate/wall geometry. It restores missing positive thickness on saved PDF/DXF/STEP drawings and synchronizes the editable review and costing fields. It preserves manual positive thickness values and detects ambiguous measurements rather than assigning an arbitrary thickness.
- Evidence version is bumped to 4 so old drawings can recover new source data. Cached, available original previews remain visible during recovery.

## Verification performed
- Backend: `python -m pytest -q` — **51 passed**, comprising the 34 prior regression tests and 17 new parametrized/regression cases. The new coverage exercises actual generated PDFs, a DXF and a STEP solid, printed/derived weight anchors, source-file mismatch, fraction/stock/pipe thickness and saved drawing recovery.
- Python compilation: `python -m compileall -q backend/app backend/tests` — passed.
- Changed TypeScript/TSX syntax: TypeScript `transpileModule` with diagnostics — passed (page, DrawingEvidence, API, types).
- Frontend dependency installation and build: unavailable in this environment. `npm ci --offline --no-audit --no-fund` failed with ENOTCACHED (undici-types); registry DNS lookup failed, and `npm run build` returned `next: not found`. Full frontend type checking, lint and browser/WebGL interaction are therefore not verified.
- Live Supabase/Render/Vercel deployment was not exercised. Existing deployment settings are unchanged.

## Before pushing
Run `npm ci` and `npm run build` in `frontend`, plus `npx tsc --noEmit`, then test Locate on your own original drawings and reopen the same quotation. The frontend currently has no lint script. Run `python -m pytest -q` in `backend` with pytest and the existing backend requirements available.

A drawing without identifiable thickness evidence must remain editable for engineer review. A value with no defensible source coordinate cannot be marked as a verified source; the interface reports missing source evidence rather than inventing a dot. Browser pixel alignment on the user's actual drawings is not verified by the backend tests.
