Manufacturing Quotation App v0.8.5

1) WORKSPACE DATASET / BACKWARD PERSISTENCE
===========================================
A new browser IndexedDB store named "workspace-datasets" is used as an automatic
workspace folder system.

Each active quotation dataset stores:
- uploaded drawing File objects
- linked 3D model File
- batch drawings
- extraction
- reviewed drawing values
- cost rows
- summary
- commercial overrides
- current workflow step/view
- DFM reports
- BOM reports
- selected DFM/BOM report
- batch failures
- customer
- saved timestamp

The active dataset is also written to the existing active-draft record.

Browser Back now carries the datasetId in history state. When Back returns to
workflow, the dataset snapshot is reloaded before the workflow screen is shown.
This prevents the drawing/cost sheet from disappearing after visiting DFM/BOM.

Dataset Learning page now includes "Workspace Dataset Folders" with Open/Delete.
These workspace folders are separate from the curated AI Training Dataset.

A new quotation creates a new workspace dataset; it does not delete old folders.

2) DFM REPORT
=============
DFM uses a cleaner table-based format consistent with the rest of the app.

Reference matrix updated using current international references:
- ISO 2768-1:1989 (with ISO 2768 Ed.2 publication transition noted)
- ISO 1101:2017
- ISO 5458:2018
- ISO 21920-1:2021
- ISO 13715:2017
- ISO 2553:2019
- ISO 9013:2017 + Amd 1:2024
- ISO 965-1:2026

These are feature-specific references, not a universal DFM certification.
Applicability must be checked against customer drawing/specification, material,
process and machine capability.

Added DFM review checks for:
- thermal cut quality
- repeated hole/pattern location
- surface texture
- current metric thread tolerance reference

3) BOM
======
BOM download is PDF only.
Word/DOCX export and python-docx dependency have been removed.

4) CURSOR
=========
Same Indian Rupee ₹ symbol remains everywhere.
- White/light backgrounds: navy ₹
- Navy/dark UI: white ₹
No circle/background.

5) DFAB LOGO / TITLE ICON
=========================
Sidebar logo source and browser tab favicon use:
https://www.dfab.in/favicon.ico

If the website icon cannot load, the existing DFAB text fallback remains.

6) UI
=====
DFM/BOM typography, headings, fields and tables are aligned with the normal
quotation/rate-master visual language.

No default costing/rate values were changed.
