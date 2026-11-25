# V104 PDF Native Extraction

This release preserves the existing STEP/CAD and quotation flows and improves PDF engineering extraction without requiring OCR for normal CAD/vector PDFs.

## Changes
- Added native positioned PDF callout recovery for split CAD cells such as `LENGTH | 188 mm`.
- Reuses the existing product-region partition so title blocks, revision tables and note boxes remain excluded from dimensional parsing.
- Native PDF callouts now supplement the structured engineering parser for length, width, height, thickness, diameters, holes, PCD-related callouts, threads, slots, chamfers, bends, welds and surface-finish text when present in selectable PDF text.
- Material and weight continue to use the existing metadata/title-block safeguards.
- Extraction pipeline version bumped so stale cached PDF extractions are not reused.

## Important limitation
A scanned/image-only PDF has no native text geometry. It still requires OCR. On low-memory Render instances the application continues to fail safely and asks for engineer review instead of inventing values.

## Verification
- Backend: 105 passed, 1 skipped.
- Release regression: 16/16 passed.
- Drawing locator: 14/14 passed.
- API routing: 6/6 passed.
