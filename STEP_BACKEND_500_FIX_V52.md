# V52 STEP backend 500 fix

- STEP/CAD analysis persistence is now best-effort only.
- A missing/unavailable database can no longer convert a valid CAD analysis into HTTP 500.
- The original STEP analysis result returns first; history/dataset persistence is attempted safely afterward.
- Existing PDF, quotation, history, viewer and costing flows are otherwise unchanged.
- Added `START_STEP_LOCAL.ps1` to launch FastAPI on 8000 and Next.js on 3000 after verifying Python OpenCascade.
