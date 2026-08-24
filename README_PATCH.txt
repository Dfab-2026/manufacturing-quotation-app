Manufacturing Quotation App — v0.6.1 FAST + ORIGINAL UI

WHAT CHANGED
============
1. UI restored from v0.5.1
   The pre-database frontend layout/theme is used again.
   No visual redesign was added.

2. Faster Rate Master / costing
   Rates and settings are cached in the backend process, so each cost row no
   longer causes repeated Neon queries.

3. Faster PostgreSQL connection
   A small reusable SQLAlchemy connection pool replaces a new database
   connection for every query.

4. Faster extraction persistence
   New extractions and reviews are inserted directly.
   The backend no longer loads and re-writes the complete extraction/review
   dataset for every drawing.

5. Faster dataset dashboard counts
   PostgreSQL COUNT queries are used instead of downloading all extraction and
   review JSON payloads.

6. Faster Gemini preprocessing
   The original PDF is sent directly to Gemini.
   Only one small compressed title-block crop is generated.
   The old 300-DPI full-page PNG render/temp-file step is removed.

7. Faster multi-drawing batches
   Up to 2 drawings analyze at the same time.
   Retry behavior remains.
   This is intentionally limited to 2 to reduce free-tier rate-limit risk.

DATABASE
========
Neon PostgreSQL remains enabled. No database rollback.

INSTALL / RESTART
=================
Backend:
  python -m pip install -r requirements.txt
  python -m uvicorn app.main:app --reload --port 8000

Health expected:
  {
    "status": "ok",
    "version": "0.6.1",
    "database": "connected"
  }

Frontend:
  npm run dev

UI
==
The frontend CSS and visible layout are restored from v0.5.1.
