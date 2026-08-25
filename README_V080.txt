Manufacturing Quotation App v0.8.0 — DFM + BOM

Preserved:
- quotation flow
- default Rate Master values
- material costing
- training popup/history
- persistent workflow/history
- latest provided CSS/cursor baseline

Rate Master unit dropdown:
Material: kg, g, ton, sheet, piece
Process: sec, min, hr
Labour: sec, min, hr, day, shift, part-time, overtime
Old saved row units are preserved so existing rates do not break.

DFM:
- new left sidebar screen
- generated automatically in background for each analyzed drawing
- Fabrication / Machining / Both classification
- manufacturing feasibility checks
- process/tooling/inspection plan
- editable report
- history, rename, delete
- PDF download
- standards baseline
- GLB/GLTF interactive 3D preview
- STL/OBJ attachment accepted but convert to GLB for browser preview
- red report-linked issue alert overlay
- exact CAD-face red highlight requires CAD/B-Rep feature coordinates

BOM:
- new left sidebar screen
- generated automatically in parallel for each drawing
- raw material, size, weight, rate/cost, standard parts
- editable rows, add/delete row
- history, rename, delete
- Word DOCX download

Persistence:
DFM/BOM history uses LocalStorage in this version, so no new database migration
is needed yet. It can be moved to Neon later.

Backend dependency:
python-docx

Install backend dependencies:
python -m pip install -r requirements.txt

Standards baseline:
ISO 2768 / ISO 2768-1
ISO 1101:2017
ISO 21920-1:2021
ISO 13715:2017
ISO 2553:2019
ISO 10303-224:2006
