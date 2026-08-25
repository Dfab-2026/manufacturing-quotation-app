Manufacturing Quotation App v0.8.1 — Fast & Effective

This version keeps all v0.8.0 functionality and default rates.

PERFORMANCE CHANGES
===================

1. NO SERVER-SIDE DRAWING PREVIEW ON ANALYZE
Old:
  upload -> render PDF preview JPEG -> base64 -> AI -> response

New:
  upload -> AI -> response
  browser shows original PDF/image directly with ObjectURL

This removes PDF rasterizing + JPEG encoding + base64 response payload from the
critical analysis path.

2. SMART TITLE-BLOCK CROP
- Vector/text PDFs: no extra title JPEG is created.
- Scan-like PDFs with very little extractable text: a smaller 120 DPI /
  quality-65 title crop is still supplied to Gemini.

3. SMALLER SECONDARY TEXT
- Secondary extracted PDF text sent to Gemini reduced from 9000 to 4000 chars.
- Original PDF is still supplied, so drawing content is not removed.

4. NO USELESS 429 RETRY
- 429 / quota / RESOURCE_EXHAUSTED returns immediately.
- Only genuine 503/timeout/unavailable errors get one short 0.8 s backend retry.
- Frontend also avoids duplicate quota retries and uses only a short 0.6 s
  retry for a real transient service error.

5. DFM + BOM INCLUDED IN ANALYZE RESPONSE
Old:
  Analyze API
  + DFM API
  + BOM API

New:
  One Analyze API returns drawing + costing + DFM + BOM

The DFM/BOM calculations are deterministic/local and tiny compared with Gemini.
Fallback endpoints remain for compatibility.

6. LESS UI STORAGE BLOCKING
- Active quotation IndexedDB autosave changed from 220 ms to 1200 ms debounce.
- Autosave pauses while analysis is running.
- DFM/BOM LocalStorage persistence is debounced 600 ms.
- This prevents large PDF/File structured-clone and JSON serialization from
  competing with the analysis/UI thread.

7. DIRECT PDF REVIEW
- Step 2 shows the original PDF directly in an iframe.
- No server-generated preview is needed.

RELIABILITY
===========
Batch Gemini concurrency remains 2 deliberately. Increasing it further can make
some Gemini plans hit rate limits sooner; the largest speed gains here remove
unnecessary work without reducing extraction accuracy.

INSTALL
=======
Backend:
  python -m pip install -r requirements.txt
  python -m uvicorn app.main:app --reload --port 8000

Frontend:
  cd frontend
  npm run dev
