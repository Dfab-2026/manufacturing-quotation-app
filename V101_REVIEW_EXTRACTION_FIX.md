# V101 Drawing Review Extraction Fix

Targeted fix for Drawing Snapshot & Basic Details without changing unrelated quotation flows.

## Fixed
- Added the missing fallback from already-parsed, high-confidence linear callouts to overall length/width when the drawing does not literally label them LENGTH/WIDTH.
- Added flange/ring planar-envelope recovery from a single explicit outer-diameter callout; bolt holes/PCD/countersinks are excluded.
- Filename-inferred material can now create a clearly PROVISIONAL material-cost quantity when deterministic geometry is sufficient.
- Filename-inferred material still does not satisfy mandatory engineering material/weight verification.
- Removes the stale "No reliable costing rows" warning when the final AI/costing pass has actually created rows.

## Safety
- Feature dimensions are not promoted to overall axes.
- Low-confidence OCR dimensions are not used for fallback envelope calculation.
- Material grade from filename stays review-required.
- Final quotation should not be released until unresolved material/weight fields are confirmed.

## Validation
- Backend: 103 passed, 1 skipped.
