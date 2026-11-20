# V81 — Compact locator and page usability

Base: V80 detail extraction. No rate values, costing formulas, BOM rules, database schema, dependency versions, existing saved records, or existing navigation actions were changed.

## Drawing viewer
- 10 px ring and 5 px red centre dot, offset 9 px from the source rectangle edge; thin outline and short connector leave the callout text readable. Left/top/bottom placement can be used near page edges. Reduced-motion preference is respected. CAD sprite reduced from 0.075 to 0.025 normalized scale.
- Page selector, previous/next, source-page label, 100–300% zoom, fit width, scrollable preview and automatic source centering. Other pages can be viewed even with an active source selection.
- PDF page count included in evidence v6. All pages can be requested from the original PDF via `/api/drawing/page` with file identity checks. Initial preview cache remains capped at 16; remaining pages render on demand. Existing extraction and anchor limits remain; pages with no extracted evidence can be viewed but do not get fabricated markers. Original file availability is required for uncached pages.
- Drawing Review, Cost Sheet, Quotation Preview, DFM and BOM have drawing evidence review. Secondary panels are collapsed initially and mount only on opening. Reports use only their matched drawing/workspace when available. Quotation Preview/DFM/BOM evidence recovery is read-only; Drawing Review and Cost Sheet retain the existing thickness recovery callback.

## Other pages
- Dashboard and quotation history: search customer/name/drawing/reference and status, count of matching records. Existing actions and sorting retained.
- Rate Master: accessible search and filtered record count; Excel import and edits unchanged.
- Dataset Learning: workspace search and matching count. Existing open/delete unchanged.
- Settings: retry state when settings cannot load. Responsive header wrapping and compact drawing tool styles.

## Verification
- Backend: 59 tests passed (normal environment, including existing 56 regression cases and 3 new PDF pagination/identity tests). A separate OCR-disabled run also passed all 59; OCR-specific tests enable their own test configuration.
- Frontend: 9/9 locator unit tests passed (Node 22 experimental type stripping). Python/TypeScript syntax compilation passed.
- Chromium: actual rotated PDF coordinates; compact marker outside the source box at 360, 768 and 1280 px, with reduced motion. This is a layout fixture test, not a full React end-to-end test.
- No new dependencies. Full Next.js build, lint/type checking and real in-app interaction remain unverified: offline npm cache lacks required packages, and online installation did not finish in the available execution time. Run npm ci, npm run test:locator, npx tsc --noEmit, npm run build, and npm audit before push/deployment.
- Both backend and frontend must be updated for the new page endpoint. Reanalyze or open the original drawing to recover older saved v5 evidence. No assertion of perfect extraction accuracy or public production security readiness.
