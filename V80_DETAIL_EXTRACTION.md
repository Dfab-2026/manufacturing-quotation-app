# V80 — Detail extraction upgrade

Base: V79 (all original ZIP entries retained). Scope: extraction, source evidence, local/API routing and OCR runtime setup. No changes to quotation layouts, rate masters, database schema, navigation or saved workflow logic.

## Deployment
- Local Windows: from backend run `python -m pip install -r requirements-render.txt`, `$env:LOCAL_OCR_ENABLED="true"`, then `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.
- Render: install the updated production requirements; set `LOCAL_OCR_ENABLED=true` in the dashboard as well as Blueprint. Check `/api/health` (`local_ocr: ready`). Restart and reanalyze the original file; saved reviews are not silently overwritten.
- Runtime uses Tesseract if the executable is present; otherwise RapidOCR + ONNX Runtime. Tesseract is not required on Windows/Render if the portable runtime initializes. ONNX models and first-start initialization need sufficient disk, RAM, CPU and network access if the installed runtime needs to retrieve assets.
- Bounded defaults `DETAIL_OCR_DPI=400`, `DETAIL_OCR_SECONDS=100`, `DETAIL_OCR_MAX_PAGES=30`, `DETAIL_OCR_MAX_TILES=160`. Partial coverage is reported, not presented as complete. Increasing limits increases latency and resource usage. RapidOCR calls themselves are not forcibly interrupted by the time budget. PDF preview generation retains V79's 16-page preview cap.
- Frontend: `npm ci`, `npm run test:locator`, `npx tsc --noEmit`, `npm run build`, `npm audit`. Local analysis/recovery now prefers local FastAPI rather than the deployed backend.

## Extraction and evidence
- Explicit Analyze reads native PDF text and overlapping 400-DPI regions, covering multiple pages subject to bounds. Small raster images are upscaled. Original vector text remains first in the engineering parser. Optical annotations retain normalized page coordinates; native/optical duplicates are suppressed for Locate.
- Optical text feeds the existing deterministic extraction for thickness, dimensions, printed weight, materials, features and purchased callouts. Recover thickness before mass/cost generation. Named Height now extracted. Existing STEP/DXF geometry routes retained.
- Image pixels cannot establish a hidden dimension; OCR can misread damaged characters, symbols or dense annotations. Bare dimensions without reliable semantics need review. No arbitrary thickness/weight is introduced by the detail reader. Existing extraction heuristics remain and require engineering validation. Multi-page component mapping, universal GD&T/assembly recognition and all-drawing accuracy are not established. Multi-frame image evidence display remains first-frame only.

## Verified in this environment
- Backend: 56 tests passed, including existing 51 tests, actual two-page raster PDF with 5.5-point source lettering, thickness 2.5 mm, width 80 mm, printed mass 0.19 kg, page-specific anchors, bounded-coverage warning, Analyze API, named height, and mocked portable OCR result format.
- Python compileall: passed. Runtime checker: passed using installed Tesseract.
- Frontend: 7 locator unit tests passed; changed TS/TSX transpilation syntax passed.
- Not verified: actual RapidOCR/ONNX execution (not installed here), full frontend production build/dependency audit (npm installation did not complete), live browser app interaction, Render/Supabase deployment, original customer drawings (not supplied with this request). Existing public-release security gates remain. Do not represent this as a certified universal production extraction system.
