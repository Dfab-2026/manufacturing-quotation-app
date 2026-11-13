# V37 targeted update

Only the requested areas were changed from v36.

- Added a persistent End Process button in the top action area so it is available from every app page.
- Existing in-workflow End Process behavior remains unchanged.
- Quotation History now opens immediately from a browser cache and refreshes quotations only in the background.
- History navigation no longer waits on settings, Rate Master, catalog, or dataset-stat refreshes.
- Quotation history fetch tries the direct Render FastAPI endpoint first, then falls back to the existing proxy.
- Quote cache stays synchronized with current quote state.
- All extraction, OCR/Gemini recovery, costing, Rate Master, DFM/BOM, upload, and quotation workflow logic remains unchanged.
