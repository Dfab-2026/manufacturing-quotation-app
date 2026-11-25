# V95 — Automatic quotation output aligned to reference STEP estimate

## Scope / preservation

This patch begins with v94. It retains the existing five-stage workflow:
Upload → Drawing Review → Cost Sheet → Quotation → Download.

Only STEP CAD exact geometry, STEP review hints, single-drawing PDF/Excel exports, and the optional 3D-viewer snapshot passed into the PDF were updated. Existing login behavior (no login), rate data, draft persistence, quotation history, admin features, batch quotation exports, Next.js navigation and styling, backend storage and all other routes remain unchanged.

## Same-file acceptance: PID#15948, Rev R2.01

Source: `[PID#15948] 316SS Flange Adaptor, RHS, EN1092-1 - LQS - DN50 PN16 x 3-Inch Tri-Clamp - R2.01 - 2025-06-05.STEP`

- Exact B-Rep bounding envelope: **165 x 188 x 165 mm**. Prior use of OpenCascade `Add()` yielded a spurious 182-mm X extent; this version uses `AddOptimal`.
- Net assembly volume: **440,614.211 mm3** (not the sum of overlapping independent solids).
- 2 geometric solids, retained as **unnamed** BOM entries until the user confirms their component identities.
- Four Ø18 mm mounting holes on Ø125 mm PCD, inferred from concentric cylindrical axes and marked review-required.
- Provisional AISI 316 weight: **3.516 kg** using CAD net volume x assumed 7.98 g/cm3 density. The material grade was a source filename hint, **not a certification**; review required.
- Revision and drawing number recovered from filename, **not treated as authoritative title-block text**.

## Customer PDF

The existing Generate Quotation action sends the most recent on-screen calculated selling price, CAD-derived engineering evidence and best-effort rendered STEP preview to `/api/export/pdf`. The report contains drawing identity, quantities, geometry, included priced operations, selling price, provisional 18% GST, total estimate, scope review items, and provisional terms. It cannot invent supplier identity, firm lead time, material certification or missing process charges. The sample ₹17,416.80 amount from an earlier *manual budget estimate* is **not hard-coded**.

## Editable Excel

The existing Cost Sheet > Export Excel downloads the original full engineering/BOM tabs with added worksheet formulas for operation costs, material wastage, overhead, markup, final selling price and provisional GST. Rate, costing quantity, percentage and commercial override cells remain editable. Formula injection prevention keeps untrusted source data as text.

## Manufacturing review requirements

A STEP model cannot reliably specify stock yield, commercial material purchase quantity, forming, welding method, passivation, NDT, tests, MTC and final tolerances. For multi-solid parts the app explicitly warns that joining/welding, forming, finishing and testing may need user-provided cost rows. Calibrate material and process rates in existing Rate Master before treating the price as a real quote. Confirm GST/HSN and contract terms independently.

**Demo notice:** On current default rate data, this STEP analysis produced a selling price of ₹6,184.98, or ₹7,298.28 with provisional 18% GST. That is **not** the earlier ₹14,760.00 pre-GST reference amount: the earlier estimate included assumed TIG welding, forming, finishing and higher material/rate allowances not defined by the CAD file. The version deliberately does not silently invent those rates or change existing stored rate masters.

## Deployment and usage

1. Back up your existing project and deployed configurations, and extract this ZIP over a separate copy.
2. Run backend from `backend/` using the project's existing Python environment:
   `python -m pip install -r requirements.txt`, then `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`.
3. Run existing frontend from `frontend/` using its current Vercel configuration. The previously identified lockfile release prerequisite still applies: with npm registry access, run `npm run release:prepare`, `npm run build`, `npx tsc --noEmit`, then commit the generated dependency manifest+lockfile together. This ZIP does **not** rewrite the dependency files.
4. Upload the STEP file, review CAD evidence and the suggested BOM, confirm material grade and rates, add missing processes in the Cost Sheet, then use the existing Export Excel and Generate Quotation actions.
5. After deploying to Render and Vercel, test a sample PDF, STEP upload, saved draft resume, cost edits, PDF/Excel download and history; these remote environments were not accessible here.

## Local verification

- `pytest backend/tests` with the actual customer STEP provided as `DFAB_TEST_STEP_FILE`: **101 tests passed**.
- Frontend `node --experimental-strip-types --test frontend/tests/*.test.mjs`: **35 tests passed**.
- Actual STEP `/api/analyze-cad-file`: HTTP 200; correct PID, revision, exact dimensions, 2 solids and Ø125 PCD.
- Actual STEP `/api/export/pdf` and `/api/export/excel`: HTTP 200; PDF rendered and inspected (two pages).
- Modified TS/TSX syntax checks: **3 files parsed with zero syntax diagnostics**.
- Python module compilation: confirmed before packaging.
- Full Next.js production build and app-wide typecheck: **not verified** due missing frontend node_modules / unavailable npm registry and pre-existing v94 release lockfile prerequisite.

## Exact source changes

Changed:
- `backend/app/cad_brep.py`
- `backend/app/main.py`
- `backend/tests/test_step_cad_analysis.py` (updated correct 316 density expectation)
- `frontend/app/page.tsx`
- `frontend/components/ModelViewer.tsx`
- `frontend/lib/api.ts`

Added:
- `backend/app/quotation_document.py`
- `backend/tests/test_v95_quotation_parity.py`
- This guide.

No previous source files were deleted.
