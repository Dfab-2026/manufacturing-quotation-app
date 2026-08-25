Manufacturing Quotation App v0.8.3

Focused changes only. v0.8.2 speed, costing, status lights, DFM/BOM logic,
Rate Master, quotation history and training behavior are preserved.

DFM / BOM PAGE LAYOUT
=====================
- Removed the permanent left-side DFM History / BOM History bar.
- DFM and BOM report content now uses the full page width.
- Added a compact History button in the page header.
- History opens in a separate modal box.
- History supports:
  * select/open report
  * date/time
  * rename
  * delete
- Closing History returns to the full report page.

GLOBAL 3D MODEL INPUT
=====================
Step 1 now has a separate 3D Model Input.

Preferred manufacturing CAD:
  STEP / STP

Also accepted:
  GLB / GLTF
  STL / OBJ
  IGES / IGS
  Parasolid X_T / X_B

The selected 3D model is linked to the current quotation and is automatically
available inside DFM. It is also saved with the active workflow in IndexedDB.

DFM still has its own Replace/Upload 3D Model button, so the engineer can change
the model from either place.

3D VISUALIZATION
================
- GLB/GLTF: interactive browser preview.
- STEP/STP and other CAD formats: linked/displayed as the manufacturing CAD
  input in DFM.
- Exact interactive STEP/STP tessellation requires a CAD/OpenCascade conversion
  layer; this patch does not fake geometry or face-level visualization.

CURSOR / OTHER UI
=================
- Indian Rupee cursor remains unchanged.
- DFM/BOM red-yellow-green sidebar status remains unchanged.
- No unrelated workflow changes.
