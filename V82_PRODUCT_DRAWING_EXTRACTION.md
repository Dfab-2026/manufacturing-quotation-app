# V82 — Product-only engineering extraction

Base: V81 compact locator and page review. All original archive entries retained.

## Changes
- Separate product annotations and dimensions from administrative title blocks, revisions, approval tables, scales and border data. Explicitly labelled drawing identity, material and printed weight remain available in their respective metadata fields, not as geometry.
- Use the same filtered source coordinates for PDF/image extraction and Locate, including OCR. Exclude recognized DXF border/title layers and blocks. Retain existing STEP geometry analysis.
- Parse explicit dimension labels and units (including inch fractions, centimetres and decimal commas). Do not duplicate a single length into width, infer an overall size from a local feature, or treat an arbitrary numerical pair as stock size.
- Detect conflicting measurements; prevent unsupported thickness, weight or width estimates. Preserve valid manual corrections. For source-scoped PDF/image inputs, do not silently fill engineering measurements from unverified AI-only fallback output.
- N/A is reserved for positively identified non-applicable fields; unresolved applicable fields remain editable and display Review required. Cached automatic analyses use the new pipeline version.

## Validation
- Backend: 69/69 tests passed (59 existing plus 10 product-region regression tests). Cases include native and raster PDF, drawing/title-block number collisions, dimension callouts, unit conversion, DXF border exclusion, conflict detection, missing-field handling and evidence recovery.
- Existing frontend locator suite: 9/9 passed.
- Changed TypeScript files: syntax transpilation passed. Python compilation passed.
- Full Next.js production build, lint, type check and live application testing are not verified: dependency installation timed out and local type packages are incomplete. Run the complete frontend checks before deploying.

## Run
Use current backend dependencies (`python -m pip install -r requirements-render.txt`). For local OCR, set `$env:LOCAL_OCR_ENABLED="true"` in PowerShell and start `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000` inside backend. In frontend run `npm ci`, `npm run test:locator`, `npx tsc --noEmit`, and `npm run build`.

Re-analyze original drawings to benefit from the new extraction policy. Previously saved/manual quotations are not silently rewritten. Keep V81 as backup.

## Limitations
Drawing-region recognition is heuristic; unusual title blocks, anonymous DXF layers, poor scans, multiple different parts on one sheet, unlabeled dimensions and ambiguous callouts may require review. A generic linear dimension without reliable overall context is not assigned to a specific envelope axis. Missing data does not establish non-applicability. Not a claim of universal extraction accuracy or production certification.
