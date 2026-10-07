# Dataset / Upload Reliability Fix

- IndexedDB schema upgraded to v3 with a lightweight workspace summary store.
- Dataset Learning list reads summaries only; old browsers perform a one-time migration from full drafts.
- Dataset navigation no longer triggers the full settings/rates/catalog/quotes refresh.
- Trained-weight sample metadata is cached in backend memory for 20 seconds to avoid repeated DB reads during multi-drawing analysis.
- Local dev CORS accepts localhost/127.0.0.1 on any port, so Next.js fallback ports (3001, 3002, etc.) can upload.
- Workspace file backup retries three times. A DB backup problem no longer makes a selected/analyzable drawing appear as a failed upload.
- Workspace upload endpoint provides clearer read/size failures and supports files up to 250 MB for DB backup.

Backend command:
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
