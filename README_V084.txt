Manufacturing Quotation App v0.8.4

Focused update only. Existing v0.8.3 DFM/BOM, speed, costing, history,
training and status-light behavior remains unchanged.

UNIFIED CHOOSE DRAWING(S)
=========================
Removed the separate 3D Model Input box.

The existing Choose drawing(s) picker now accepts:
- PDF
- PNG / JPG / JPEG
- DXF
- DWG
- STEP / STP
- GLB / GLTF
- STL / OBJ
- IGES / IGS
- Parasolid X_T / X_B

Internal behavior:
- PDF/Image/DXF/DWG files are treated as quotation drawings.
- STEP/STP and other 3D/CAD formats are automatically linked to DFM.
- The same picker can select a drawing and a 3D model together.
- DFM still keeps an optional Replace 3D Model button.

Important:
STEP/STP is linked as the manufacturing CAD model. Interactive browser
visualization still uses GLB/GLTF until a CAD tessellation/OpenCascade layer
is added.

CURSOR
======
Cursor is now only the Indian Rupee symbol ₹.
No circle, no round border, no background.

DFAB LOGO PLACEHOLDER
=====================
The sidebar AI Quotation / Manufacturing Costing header now has a DFAB logo
image placeholder.

To connect the real logo later, add:
frontend/public/dfab-logo.png

If that image is not present, a clean DFAB placeholder remains visible.
