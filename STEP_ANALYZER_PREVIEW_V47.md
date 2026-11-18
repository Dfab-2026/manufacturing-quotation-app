# V47 STEP Analyzer + Preview

Targeted update only. Existing PDF analysis, quotation flow, history/drafts, costing UI, navigation, and unrelated features are preserved.

## STEP/STP analysis
- STEP/STP continues to be triangulated in-browser through OpenCascade WASM.
- Extracted CAD geometry is sent to the existing FastAPI `/api/analyze-cad` path.
- Added STEP metadata parsing for schema, product/component names, material designation/name hints, B-Rep entity counts, cylindrical diameters, and thread-like designations.
- Overall X/Y/Z, surface area, solid volume, part/mesh/triangle counts remain available.
- Plate-like STEP parts map the smallest envelope dimension to thickness and the two larger envelope dimensions to width/length.
- When STEP material is recognized, weight is calculated from solid volume × recognized density and feeds the existing costing-row generation.
- Cylindrical, thread-like, and conical STEP features are surfaced as review-required candidates rather than asserted as exact holes/chamfers when topology semantics are ambiguous.

## STEP preview
- Step 2 Drawing Snapshot now renders STEP/STP/IGES through the existing interactive model viewer.
- Three.js uses the project's installed dependency instead of a separate external Three.js script.
- `postinstall` copies the `occt-import-js` JS/WASM runtime into `public/vendor/occt` for same-origin production use, while the existing external runtime fallback remains available.

## Validation
- Python syntax check passed.
- Backend test suite: 10 passed.
- Added STEP-specific API tests for material, geometry, weight, feature candidates, missing-material behavior, and response compatibility.
- Frontend TypeScript/build could not be executed in this environment because npm dependency installation timed out before type packages were fully available. No frontend dependency versions were changed.
