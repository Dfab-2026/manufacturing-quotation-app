# V84 — product-only measurement cleanup

Base: V83 Render OCR deployment fix. OCR configuration, build checks, original rate masters, database configuration, quote calculations, navigation and project layout are retained.

## Targeted changes
- Shared drawing-region filtering rejects general tolerance, scale, general administrative statements and part-number cells as geometry. Explicit supported material/weight metadata remains field-specific. Image evidence thickness recovery respects the product-region filter.
- Repeated named dimensions and generic readbacks are consolidated; distinct axes of equal magnitude, conflicting values, distinct tolerances and CAD entity handles are not merged. Tolerances attach to the matched measurement rather than the last inserted row.
- Review tables, interactive evidence views and detailed Excel dimensions use concise names such as Length, Width, Height, Thickness. Internal CAD axis identity remains available for geometry evidence. Stale source anchors do not create extra measurement rows. Duplicate generated notes are hidden in the drawing notes display, while original data and actionable warnings remain intact.
- Pipeline and evidence versions incremented to refresh automatic extraction/source evidence. Re-analyze affected drawings to replace outdated automatically extracted data; existing user-approved records are not silently rewritten.

## Verification
- Backend pytest: 76 passed (73 existing + 3 targeted tests).
- Frontend locator tests: 11 passed (9 existing + 2 targeted tests).
- Python compileall: passed.
- Strict TypeScript check for the locator module: passed. All three changed frontend TS/TSX files transpile successfully.
- Full Next.js build, full-project type check/lint and browser interaction not verified: npm ci --offline failed with missing cached undici-types dependency. No dependency versions changed. Render RapidOCR/ONNX runtime and live Supabase not verified here.
- Original ZIP entries compared by file bytes; only the listed targeted code files plus new helper/test/release note differ. No temporary database, node_modules or build outputs are included.

Before deploying, run frontend npm ci, npm run test:locator, npx tsc --noEmit, npm run build. Retain the V83 Render build smoke test and LOCAL_OCR_ENABLED=true. OCR cannot guarantee recognition on every drawing; unresolved or ambiguous measurements require review rather than fabrication.
