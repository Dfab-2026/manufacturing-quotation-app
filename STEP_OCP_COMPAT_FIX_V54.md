# STEP OCP compatibility fix v54

Fixes Python OCP wheels where `TopoDS.Face_s` / `TopoDS.Edge_s` are unavailable.
The STEP B-Rep extractor now uses the existing version-tolerant `_call_static()` helper,
which selects either the `*_s` binding or the classic static method automatically.

Changed only: `backend/app/cad_brep.py`

Validation:
- Backend tests: 15 passed
- Direct OpenCascade face/edge cast smoke test: passed
