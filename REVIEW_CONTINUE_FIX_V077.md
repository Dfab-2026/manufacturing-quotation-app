# v0.7.7 — Save Review & Continue navigation fix

The original application UI, styling, API implementation, database, rate masters, costing and PDF flows remain unchanged. Only `frontend/app/page.tsx` changes.

## Behavior
- Clicking Save Review & Continue immediately transitions from Step 2 to Step 3 using the currently reviewed drawing and cost rows.
- IndexedDB draft, IndexedDB workspace and remote review save start independently, with success/failure feedback.
- DFM and BOM generation run concurrently and independently of review persistence.
- Revision-history sync and dashboard refresh remain best-effort.
- Navigation does **not** imply a server-side save succeeded. Read the status message; do not close the tab if both local and server saving failed.

## Run
Frontend: `cd frontend && npm install && npm run dev`
Backend: `cd backend && python -m venv .venv && .venv\\Scripts\\Activate.ps1 && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`

## Verification
TypeScript TSX parsing: pass. Python compilation: pass. Original ZIP comparison: only `frontend/app/page.tsx` application file changed. Full Next.js build and live end-to-end testing were not completed because installing npm dependencies failed in this environment.

## Manual acceptance test
Upload one drawing; Analyze; edit a drawing field; click Save Review & Continue once; confirm Step 3 Engineering & Cost Sheet appears immediately. Check the status message for persistence success/failure; reopen the draft and verify the edited field persists; verify DFM and BOM independently finish or show a failure state. Repeat with backend stopped to confirm immediate navigation and browser draft saving when IndexedDB is available.
