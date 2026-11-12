# ORIGINAL UI PRESERVATION / VALIDATION

Base project: manufacturing-quotation-app-main(4).zip (Next.js 14 frontend + FastAPI backend).
This is the original `frontend/app/page.tsx` and `frontend/app/globals.css` design, NOT the unrelated `manufacturing-quotation-platform` app.

Application changes versus the original upload:
- frontend/app/page.tsx: previously requested upload-status, editable commercial percentages, rate navigation and autosave corrections.
- frontend/app/globals.css: additive percentage-input styles only.
- frontend/lib/api.ts: accepts nullable per-quotation percentages.

Added documentation/config examples:
- RUN_THIS_PROJECT.md
- backend/.env.example

Unchanged: all backend application code, logo, Next.js layout, 3D model viewer, CAD utility, quotation/PDF generation backend, existing master data and storage models.

Checks performed in this environment:
- Python `compileall` on backend/app: PASS
- Original vs updated archive file-by-file diff: PASS (only listed code files changed)
- Zip checksum/integrity: PASS
- Full Next.js build/typecheck: NOT VERIFIED (dependency directory is incomplete: `next` CLI unavailable)
- Live database/Gemini integration: NOT VERIFIED (no user's secret or production database access)

Deployment note: The original UI project uses `frontend/` + `backend/`, not the `apps/web` monorepo. Follow RUN_THIS_PROJECT.md. Never commit actual secrets.
