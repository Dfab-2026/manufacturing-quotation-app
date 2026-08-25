Manufacturing Quotation App v0.9.0

CONCEPT FIX
===========
Every uploaded source is now a separate quotation item.

Example:
- part-A.pdf
- body.step
- photo.jpg

Result:
1/3 part-A.pdf  -> own extraction, review, costing, BOM, DFM
2/3 body.step   -> own CAD geometry extraction, review, costing, BOM, DFM
3/3 photo.jpg   -> own extraction, review, costing, BOM, DFM

A STEP file is NOT linked to a PDF and never reuses the PDF's drawing data.

STEP / STP / IGES
=================
Browser-side OpenCascade/WASM parses the CAD source independently.

Extracted CAD metrics:
- overall X/Y/Z
- part count
- mesh count
- triangle count
- triangulated surface area estimate
- triangulated solid volume estimate
- CAD assembly/component names where available

These metrics are sent to /api/analyze-cad and converted into the same:
- Drawing Review
- Engineering details
- process recommendation
- Rate Master costing rows
- quotation summary
- DFM
- BOM

Material, grade, tolerances and surface-finish are intentionally flagged for
review when they cannot be reliably obtained from the CAD geometry.

OTHER CAD FORMATS
=================
GLB/GLTF/STL/OBJ/X_T/X_B remain separate quotation sources too.
If exact geometry parsing is unavailable, a separate review/costing item is
still created and the missing geometry is clearly flagged instead of borrowing
data from another drawing.

DFM 3D MODEL
============
DFM now resolves the model by that DFM report's own file_hash.

- STEP DFM -> shows that STEP model
- another STEP DFM -> shows that other STEP model
- PDF DFM -> no 3D model box
- no cross-file linking

STEP/STP/IGES viewer is interactive and uses browser-side OpenCascade
triangulation plus Three.js. Viewer is a compact 300 x 300 square.

ALL PREVIOUS
============
Database persistence, upload status, back restore, assembly extraction,
Rate Master, costing, BOM PDF, DFAB branding and ₹ cursor remain unchanged.
