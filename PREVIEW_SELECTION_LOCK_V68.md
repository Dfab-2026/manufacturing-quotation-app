# V68 — Drawing Preview Selection Lock

## Targeted fix

- Separated the Drawing Review preview source from the active DFM/BOM report source.
- Selecting a different source inside DFM or BOM no longer replaces the drawing preview shown when returning to Drawing Review.
- Explicit source selection in Drawing Review, initial analysis, and batch continuation still updates the preview to the chosen drawing.
- Persisted `previewSourceKey` with the active workflow, local workspace dataset, Draft/History snapshots, Ongoing backup, and remote workspace session so Continue restores the same source.
- Bound PDF/image object URLs to the exact source File object. A previous file URL is never displayed while a different source is loading; the preview shows a loading state instead.
- Keyed preview components by source identity and clear the old STEP canvas before parsing a newly selected/restored model.
- Persist the current workflow snapshot before navigating to Dashboard, Quotation History, Rate Master, Dataset Learning, or Settings.

## Preservation

No Ongoing/Draft/History actions, quotation calculations, drawing analysis, DFM/BOM generation, cost sheet, quotation export, database schema, or page layout were intentionally changed. The existing v67 project is the base; this update is limited to preview source selection, preview rendering lifecycle, and saving the preview selection during navigation.

## Validation

- Frontend TSX transpilation: passed for `frontend/app/page.tsx` and `frontend/components/ModelViewer.tsx`.
- Frontend config/script syntax checks: passed.
- Backend Python compile: passed.
- Backend tests: 18 passed.
- Full Next.js production build: not run in this workspace because frontend `node_modules` is not installed. Run `npm install` and `npm run build` in `frontend` before deployment.
