Manufacturing Quotation App v0.7.4

USER REQUESTED UPDATES
======================

1) MATERIAL COST FIX
- No full-sheet charging for sheet/plate parts.
- Costing blank = extracted overall length + 100 mm AND overall width + 100 mm.
- Example: 300 x 400 mm drawing -> 400 x 500 mm costing blank.
- Weight = blank L x blank W x thickness x material density x quantity.
- Material amount = calculated blank kg x Rate Master ₹/kg.
- Cost row description shows the blank dimensions used.
- Existing editable material rate/qty behavior remains.

2) QUOTATION -> SEND TO TRAINING POPUP
- PDF/ZIP downloads first.
- Immediately after download, popup asks "Send to Training?"
- Nothing is added to the curated Training Dataset unless the user clicks Send.
- If approved, the app stores:
  * original drawing bytes
  * file hash / filename
  * AI raw extraction/features
  * final reviewed drawing details
  * final cost rows
  * quotation summary
  * customer
- Same exact source drawing hash updates its curated sample instead of creating duplicate training weight.

3) TRAINING DATASET
- New Neon table: training_samples (created automatically by SQLAlchemy create_all).
- Dataset Learning page now shows Training Samples separately.
- Export Training Dataset ZIP contains:
  * training_dataset.jsonl
  * drawings/<original approved drawing files>
- Extraction/review history remains separate; only explicitly approved samples are training samples.

4) LOADING ANIMATION
- Engineering-style animated analysis indicator added during drawing analysis.

5) FIXED LEFT MENU
- Left navigation stays visible while the main page scrolls.

6) SPEED
- Analyze endpoint now returns calculated summary with extraction, removing one API round trip.
- Batch analysis concurrency increased from 1 to 2.
- Background refresh after analyze/review no longer blocks the workflow UI.

IMPORTANT
=========
Deploy backend first so the new training_samples table/API exists, then frontend.

LOCAL:
backend:
  python -m uvicorn app.main:app --reload --port 8000

frontend:
  cd frontend
  npm run dev
