# V94 – backend warning and engineering PDF extraction reliability

**Base:** `manufacturing-quotation-app-v93-vercel-deployment-audit.zip`. This is a narrow, backend-only patch. The frontend (including its unresolved release lockfile requirements), pages, UI, draft/history workflows, quotation calculations, DFM/BOM and STEP analyzer are unchanged.

## What was confirmed and fixed

1. **Obsolete PyMuPDF imports** – The warning from `fitz/__init__.py` is a deprecation warning, not proof that Uvicorn has crashed. All old `import fitz` usages in `backend/app/` now use `import pymupdf as fitz`, keeping the same `fitz.*` method calls.
2. **Missing material from drawing title/filename** – Real drawing strings such as `316SS` were being ignored by the title-block material-line filter. The PDF source now supports that spelling, and PyPDF's independently recovered text is a fallback for *metadata only* (not numerical part dimensions). An explicit drawing material always overrides a conflicting filename.
3. **Separated title-block label/value cells** – Vector PDFs where `MATERIAL` is in one cell and `SS 316` is beside it, or `WEIGHT` and `0.142 kg` are in separate cells, now pair only proximate/valid metadata. Those values are never inserted into the dimensional measurement set.
4. **File identity/revision fallback** – If the actual drawing has no readable ID or revision, an explicitly patterned filename `[PID#16494] ... - R2.00-2025-06-05.pdf` supplies *review-required* identity and revision. Printed title-block data takes precedence. No numeric size is inferred from filenames.
5. **Safe material provenance** – A filename-only alloy grade is marked `filename_review_required` with reduced confidence, warnings, and incomplete mandatory status. It **cannot** produce an automatic geometry-derived weight using unverified density.
6. **Repeated expensive rendering** – Repeated source-text extraction for the same file/optical annotations now reuses a small, bounded, process-local cache of *only parsed strings*. It does not retain binary PDFs or page image data and does not change source-evidence mapping.
7. **Cache correctness** – Advanced the extraction pipeline ID to `fastapi-product-regions-v23-metadata-reliability` so outdated automatic extractions are not incorrectly reused.

## What this fix cannot prove from the supplied materials

The chat included a screenshot and historical Render logs, **not the original manufacturing drawing PDF**, complete current backend traceback, or a live Render instance. Therefore, no claim is made that all dimensions, tolerances, weights or small scanned text in that specific document were extracted. OCR on scanned or tiny annotations still requires a working Tesseract or RapidOCR backend with adequate memory (the existing minimum ONNX memory guard is unchanged). If OCR is disabled or unavailable, source values that cannot be verified remain for manual review.

The earlier PostgreSQL `drawings.tenant_id` compatibility fix from v91 is retained unmodified. Existing v92/v93 frontend deployment lockfile constraints remain unmodified. Deploy the backend first; updating the backend alone does not regenerate a frontend lockfile.

## Local Windows backend run

From PowerShell after replacing the project files with V94, close the old Uvicorn terminal:

```powershell
cd "D:\DFAB PROJECT\Cost estimate\manufacturing-quotation-app\backend"
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python verify_runtime.py
python -c "import pymupdf; print('PyMuPDF', pymupdf.VersionBind)"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check `http://127.0.0.1:8000/api/health` and `http://127.0.0.1:8000/api/ocr/health`. The latter tests whether the selected optical reader actually recognizes text (not just whether it is installed). Rerun Analyze on an uploaded PDF to bypass previously cached results from the older extraction version. OCR may take longer for scanned drawings; on low-memory Render plans the existing ONNX OCR safety guard avoids a server restart but cannot extract raster-only labels.

## Checks performed in the packaging environment

- Backend: **95/95 tests passed** (`PYTHONPATH=backend pytest -q backend/tests`), including new synthetic fixtures for material, split metadata/weight, document-vs-filename precedence, source-text caching, and API extraction.
- `python -m compileall -q backend/app backend/tests`: passed.
- `PYTHONPATH=backend python backend/verify_runtime.py`: passed in this environment (Tesseract present; local optional dependencies are environment-specific).
- Imported the running application and backend extraction modules with **zero `fitz` FutureWarnings**.
- `GET /api/health`: HTTP 200.
- Preserved frontend tests: locator **14/14**, routing **6/6**, release/Vercel config **15/15** passed.
- Full frontend production build and TypeScript compilation: **not rerun**, because no frontend sources changed and the previous lockfile remains incompatible with the release policy. No live Windows/Render/Vercel deployment was performed.

## Change scope

Modified: `backend/app/main.py`, `backend/app/drawing_evidence.py`, `backend/app/extraction/detail_ocr.py`, `backend/app/extraction/ocr_runtime.py`, `backend/app/extraction/pdf_render.py`, `backend/app/extraction/product_regions.py`.

Added: `backend/tests/test_v94_metadata_recovery.py`, this document.

No existing files deleted. All other files are copied byte-for-byte from V93.
