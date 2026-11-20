# V79 — Visible drawing evidence and release gates

Base: V78 CAD build hotfix. V78's unrelated workflows, rates, data files,
API contracts and navigation are retained. No new application runtime dependencies.

## Locator changes
- Registered 2D evidence is drawn inside the exact image's display rectangle;
  fixed red dot, crosshair, callout outline and an animated ring remain distinct
  at small viewport sizes. The permanent dot/ring does not disappear after the pulse.
- Every measurement is matched by semantics and numerical value, with invalid
  bounds discarded. Repeated matching source callouts are retained; they are not
  claimed to be unique. Page-specific anchors cannot drift onto a first-page thumbnail.
- A source selection is preserved through recovery; clicking an unmatched row
  triggers a fresh recovery once per row, with explicit retry available. Source
  hash checks prevent mismatched evidence being used.
- STEP/IGES markers are camera-facing, depth-independent and remain visible after
  pulsing. Camera rotation takes place around the part centre rather than the
  original model origin; original mesh and evidence coordinates share that transform.
- Selected row, matching callouts, page controls and a clear action are visible.
  Weight continues to locate source measurements and not an invented coordinate.
- No fabricated marker for measurements without source evidence. OCR/CAD parser
  limitations and manually overridden values may require engineer review.

## Validation performed in this environment
- Backend: `python -m pytest -q tests`: 51 passed.
- Frontend pure locator tests: `npm run test:locator`: 7 passed.
- New/changed TS/TSX syntax: TypeScript transpilation passed. Not full type checking.
- Chromium layout check: real rotated, second-page PDF from backend; source pixel-coordinate
  alignment and visible marker at 360, 768 and 1280px: passed. This test uses the actual
  locator CSS, not a mounted Next.js component. Run optionally with Python Playwright and
  Chromium: `python frontend/tests/verify_locator_overlay.py` (set CHROMIUM_PATH if using
  a system Chromium binary).
- npm registry unavailable in the execution environment; full Next build, full TS
  checking, actual React end-to-end interaction, and live 3D WebGL interaction were not
  verified. The reported 1 critical and 2 high npm findings remain unresolved here.
- Production Supabase/Vercel/Render connections have not been live tested here.

## Release checks
The existing CI frontend job pointed to nonexistent root lint/typecheck/workspace
scripts. It now installs the active frontend's lockfile, executes locator tests,
production build, full type checking and fails on high or critical npm audit findings.
The new backend job installs the Render parser dependencies and runs the active API
regression suite. Existing extractor job retained. Require those jobs in branch protection;
CI by itself does not prevent a separately configured auto-deployment.

Windows, from the project folder:
```
cd frontend
npm ci
npm run test:locator
npx tsc --noEmit
npm run build
npm audit --audit-level=high
```
From the backend folder, in its virtual environment:
```
python -m pip install -r requirements-render.txt pytest httpx
python -m pytest -q tests
```
Do not use `npm audit fix --force` without reviewing and regression-testing major
upgrades. A successful build is not a security audit.

## Public/worldwide release gates (not yet completed)
1. Current application has no verified public multi-tenant authorization boundary.
   Require authenticated users, organization-scoped storage and record ownership
   checks on all quote, drawing, rates, history and export endpoints before public use.
   Do not expose the current API or app publicly as a multi-company service.
2. Keep confidential drawings, source workbooks, historical training records,
   exports, and connection strings out of public repositories and public bundles.
   The original private_reference directory remains intact for company use and is
   already gitignored; review existing tracked backend/data files before publishing.
3. Configure production DATABASE_URL with required SSL and a restricted database
   role; check `/api/health` for connected persistent database and run restore tests.
4. Restrict CORS and network access to authorized deployment domains; apply upload
   quotas/rate limits, malware scanning, request timeouts, retention policy, logging
   and monitoring at the hosting boundary. Validate TLS and backup/restore.
5. Complete dependency remediation, browser E2E runs for real customer drawings
   (PDF/DXF/STEP), load tests and accessibility review. Engineering predictions and
   missing data still require engineer verification before a quote is issued.

This is a targeted locator reliability release, not a claim of worldwide public SaaS readiness.
