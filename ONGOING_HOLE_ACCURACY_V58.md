# V58 targeted fixes

- Ongoing restore now tolerates localStorage backup snapshots where File/Blob values are null, preventing `Cannot read properties of null (reading 'name')`.
- File/source/batch restore filters invalid file placeholders while preserving analysis, drawing, rows, costing, navigation, DFM/BOM and customer state.
- STEP hole counts no longer come from raw CYLINDRICAL_SURFACE/CIRCLE entity counts.
- Python OCP deduplicates distinct cross-cylinder axes for elongated parts and returns conservative physical hole candidates.
- STEP cylindrical/circular dimension rows now use quantity 1 because topology face/edge counts are not physical feature quantities.
- All unrelated PDF, STEP preview, costing, history, Draft/Ongoing UI and quotation flows are unchanged.

Validation: backend pytest 17 passed.
