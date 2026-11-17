# v0.8.0 Analysis Resilience

Targeted reconstruction of drawing analysis while preserving the original UI and existing quotation workflow.

## Fixed
- PostgreSQL UUID persistence: drawings.id is now a deterministic UUID derived from file hash instead of the raw SHA-256 digest.
- CAD analyzer no longer relies on undefined feature variables; holes/threads/chamfers/bends/etc. are initialized in the structured result.
- PDF Vision timeout/failure falls back to local extraction + Predicted / Needs Review instead of stopping the workflow.
- Image Vision timeout/failure falls back to an editable predicted review.
- DXF parser failure falls back safely.
- DWG/STEP/STP/IGES/IGS/STL/OBJ/GLB/GLTF/Parasolid analysis paths return editable structured fallback data if exact geometry parsing is unavailable.
- Added BMP/TIFF input support to the upload/analyze path.
- Review UI clearly labels predicted analysis and lists predicted fields.
- Extraction pipeline version bumped so stale broken cache entries are not reused.
- Gemini defaults to one attempt for interactive speed. Optional GEMINI_MAX_ATTEMPTS=2 enables one transient retry.

## Safety rule
Predicted fallback never fabricates unsupported numeric geometry. Unknown dimensions/material/weight stay blank/zero and are explicitly marked Needs Review. Process suggestions inferred from file type are low-confidence and editable.
