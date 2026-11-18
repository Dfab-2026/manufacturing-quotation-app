# STEP B-Rep Analyzer V51

This patch keeps the existing browser STEP viewer and adds a second, server-side Python OpenCascade extraction path.

## CAD analysis route

1. Browser OpenCascade/WASM renders the STEP model and produces a lightweight geometry summary.
2. The original STEP/STP/IGES/IGS file is also uploaded to `POST /api/analyze-cad-file`.
3. FastAPI uses `cadquery-ocp-novtk` / OCP to read the original B-Rep.
4. Exact B-Rep bounding dimensions, volume, surface area, cylindrical diameters, circular edges, toroidal radii, conical faces and a conservative wall-thickness candidate are merged with existing STEP metadata/PMI.
5. Material is detected from actual STEP metadata first and filename/product names second (e.g. `316SS`).
6. Recognized material density + exact B-Rep volume gives calculated per-piece weight.
7. STEP solid-volume weight is used for the material costing quantity instead of the old sheet blank-envelope rule.
8. Browser geometry remains the fallback if Python OCP is missing or a particular CAD file cannot be opened server-side.

## Required backend package

`cadquery-ocp-novtk==8.0.1.1.0`

The project Python version is pinned to 3.12. The current OCP release supports Python 3.11-3.14.

## Ports

Frontend scripts are pinned to port 3000. FastAPI remains on port 8000.
