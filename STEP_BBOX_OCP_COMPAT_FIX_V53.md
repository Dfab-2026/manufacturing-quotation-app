# STEP B-Rep Bounding Box OCP Compatibility Fix — v53

## Fixed
Python OpenCascade extraction could emit:

`TypeError: Unable to convert function return value to a Python type! ... Bnd_Box::Limits`

The STEP B-Rep analyzer no longer uses `Bnd_Box.Get()/Limits()` for model bounds. It now reads the bounding box through `CornerMin().Coord()` and `CornerMax().Coord()`, matching the binding-safe approach used by CadQuery's OCP integration.

## Preserved
- STEP 3D preview
- Browser CAD geometry fallback
- Material recognition
- STEP volume/surface area
- Weight and material-cost flow
- PDF analysis
- Quotation/history/Draft/Ongoing flows
- Frontend port 3000 / FastAPI port 8000

## Validation
Backend pytest suite: 15 passed.
