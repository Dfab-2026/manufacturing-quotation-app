# V59 — Ongoing Exact Resume + Canonical STEP Feature Accuracy

Targeted update only. Existing PDF, costing, quotation, history, STEP preview, material/weight, draft and unrelated UI flows are preserved.

## Ongoing
- Suspended quotation remains in dedicated IndexedDB/local cache.
- Resume suppresses normal autosave while React rehydrates the snapshot, preventing the blank New Quotation state from racing and overwriting the restored quote.
- Exact saved step is restored.
- Suspended cache is deleted only after the resumed snapshot is successfully saved as the active workflow draft.
- Workspace dataset persistence is secondary and cannot block visible restore.

## STEP accuracy
- Python OCCT B-Rep result is authoritative for geometric features when available; browser mesh/entity observations are no longer appended to exact server features.
- Holes are detected only from internal cylindrical surfaces.
- Repeated/split faces and circular edges are deduplicated by physical cylinder axis.
- Counterbore/coaxial cylinders remain one physical hole axis instead of multiple holes.
- Longitudinal tube/rod bore is excluded from cross-hole quantity.
- External cylinders/bosses are not classified as holes.
- Engineering dimensions are canonicalized to overall X/Y/Z, semantic primary OD/ID, verified hole diameter/quantity, and unique bend/torus radii rather than every CAD face/edge.

## Verification
- Backend regression suite: 17 passed.
- Synthetic OCCT rod: Ø50 × 150 with two Ø10 side holes -> exactly 2 holes.
- Synthetic OCCT rod with an external side boss -> 0 holes.
- Authoritative merge test: browser 8-hole observation is replaced by server 2-hole B-Rep result while non-geometric metadata is retained.
- Full Next.js build was not completed in this environment because npm dependency installation timed out; no claim of successful full frontend build is made.
