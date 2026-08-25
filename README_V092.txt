Manufacturing Quotation App v0.9.2 — Stable All-Source Analysis

FIXES
=====
1. Analyze screen remains simple:
   Analyzing…

2. CAD warm-up:
   STEP/STP/IGES parser starts loading as soon as a CAD file is selected.
   Geometry inspection is cached, reducing delay when Analyze is clicked.

3. STEP/STP/IGES:
   OpenCascade/WASM independent parser retained.

4. STL:
   Binary and ASCII STL geometry parser added.
   Extracts bounding dimensions, triangle count, surface-area estimate and volume estimate.

5. OBJ:
   Native text parser added.
   Extracts vertices/faces, bounding dimensions, triangle count, surface-area estimate and volume estimate.

6. GLB/GLTF/X_T/X_B/DWG:
   Each remains an independent source.
   If exact geometry cannot be parsed, the app produces an independent
   Review Required output instead of hanging or copying another file.

7. No-output protection:
   If the primary parser/Gemini route fails after its controlled retry,
   the frontend calls /api/analyze-fallback.
   The source still gets its own Review / Costing / BOM / DFM item, with
   uncertain fields clearly marked Review Required.

8. Upload/database persistence remains background/asynchronous.

IMPORTANT
=========
Fallback output never invents dimensions/material. It creates an independent
review-required source so the workflow does not become blank or stuck.

No unrelated Rate Master, costing, DFM/BOM UI, DFAB logo or cursor changes.
