# V60 - Ongoing = latest saved Draft + preview restore

Targeted changes only:

- New Quotation now waits until the current work is successfully saved to Quotation History as `Draft / Incomplete` before clearing the screen.
- The Ongoing diamond no longer uses a separate suspended-workflow cache as its source of truth.
- Ongoing now resolves the most recently saved Draft / Incomplete record from Quotation History (preferring the exact draft ID created by New Quotation) and continues that draft.
- Each draft created by New Quotation or Save Draft stores its exact File-backed workflow snapshot in IndexedDB under the History quote ID.
- Opening a Draft from Quotation History and clicking Ongoing use the same restore path.
- STEP/PDF/image source files, active source key, analysis, rows, summary, customer, DFM/BOM state and workflow step are restored from the draft snapshot, allowing the Drawing Snapshot preview to render again.
- Older History drafts saved before this version still open their saved quotation data; their original preview file can only be restored if a local File-backed snapshot exists.

Unchanged: STEP/PDF analyzers, costing, Rate Master, DFM/BOM generation, quotation output, History layout, Ongoing diamond UI/animation, and unrelated flows.

Validation:
- `frontend/app/page.tsx` passed TypeScript transpile syntax validation.
- Full Next.js build was not run because this environment does not contain a complete frontend dependency installation (`next` executable missing).
