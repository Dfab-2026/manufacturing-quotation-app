# Core weight/thickness correction

- Always sends a compact title-block crop to Vision even when the PDF text layer is long; many engineering PDFs have broken embedded-font character maps.
- A model-produced weight is accepted as drawing-stated only when explicit visual evidence supports WEIGHT/WT/MASS with units.
- Existing extraction cache is versioned and stale pre-fix cached analyses are bypassed automatically.
- Drawing-stated weight has priority over all geometry prediction.
- Default 100 mm thickness is no longer written into Drawing Review/Part Summary as if it came from the drawing. It is only an internal fallback for geometry costing when no authoritative weight exists.
- If a drawing-stated weight exists, Material Cost can be applied without inventing dimensions/thickness. The 1 kg allowance remains separate and editable.

Regression example supplied by user: drawing 15948 visibly states Weight 3.53 kg. Expected engineering weight = 3.53 kg; default costing weight = 4.53 kg with 1 kg allowance.
