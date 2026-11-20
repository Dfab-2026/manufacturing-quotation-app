# V83 — Render drawing reader deployment fix

Base: V82 product-only extraction. All frontend code, costing, BOM, saved data, database schema, and extraction geometry rules remain unchanged.

## Identified cause
The screenshot reports an unavailable detailed drawing reader. V82 already includes production OCR requirements and enables OCR in render.yaml, but the old 512 MB workaround instructed operators to disable OCR. The live service's exact environment and installed packages could not be inspected. Its configured build command and deployment status must be checked in Render.

## Changes
- Updated Render build command with a real OCR smoke test (`python verify_runtime.py --require-ocr`), which refuses to pass if OCR is disabled, dependencies are absent, initialization fails, or test callouts are not recognized.
- Added `/api/ocr/health` (synthetic recognition check; briefly cached) and explicit configuration/pipeline version fields in `/api/health`.
- More specific missing-reader / disabled-reader / initialization failure messages.
- New extraction pipeline version invalidates old automated extraction caches. Incomplete OCR results are retried when OCR becomes available. Engineer-reviewed corrections are retained.
- Superseded the obsolete 512 MB workaround documentation.
- Four regression tests for configuration, dependency absence, real OCR and diagnostics.

## Render deployment (existing service)
Root directory: `backend`
Build command: `python -m pip install --upgrade pip && pip install -r requirements-render.txt && python verify_runtime.py --require-ocr`
Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
Environment: `PYTHON_VERSION=3.12.10`, `LOCAL_OCR_ENABLED=true`, `DETAIL_OCR_DPI=400`, `DETAIL_OCR_SECONDS=100`. Preserve existing `DATABASE_URL` and other settings.
After saving the environment/build settings, clear build cache and deploy the current Git branch. Check `https://ai-quotation-api.onrender.com/api/ocr/health` for `verified: true`, `reason: recognition_passed`, and `extraction_pipeline_version: fastapi-product-regions-v20-deploy-ocr`. Reanalyze the original drawing after the reader is verified. Keep the Vercel frontend pointed to that backend.

## Verification
- Backend regression: 73/73 passed (local Python 3.13.5, Tesseract installed).
- Frontend locator tests: 9/9 passed (Node 22.16.0).
- Python compilation and runtime verification with actual synthetic THK 2.5 mm / WIDTH 80 mm recognition passed.
- Frontend source and dependencies unchanged. Full Next.js production build not rerun.
- Live Render health endpoint not accessible from this environment. RapidOCR/ONNX not installed locally; external package access unavailable. The new Render build test is needed to validate its actual OCR engine and model availability. Instance memory/CPU sufficiency, live database and real customer drawing accuracy not verified. If the build/runtime reports OOM or unavailable model downloads, investigate Render logs and provision adequate resources; do not disable OCR to hide the issue.
