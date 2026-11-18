# V65 Preview Persistence Fix

Targeted changes only:
- Autosave now persists quotation-lifetime source File references instead of transient empty page state.
- Save-before-navigation uses the same durable workflow snapshot.
- Draft workspace datasets are retained after New Quotation and are deleted on normal completion/end process.
- Ongoing/History Draft restore falls back to the retained dataset if the history snapshot lacks live File objects.
- STEP/PDF/image preview source is therefore restorable after forward/back navigation and Draft continuation.

No changes were made to STEP analysis, costing, quotation calculations, Ongoing selection logic, History UI, DFM/BOM, or unrelated screens.
