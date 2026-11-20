# Manufacturing review update — V70 (verification build)
Base: V69. No navigation, database schema or backend hosting changes. 

Implemented: editable manufacturing classification and quotation scope in drawing review, existing process route and detected overall dimensions, conditional feature tables, expanded standard-part BOM recognition, customer-supplied BOM categories, scope-filtered cost rows on Save Review, explicit BOM purchase-cost transfer for the active quote, original PDF page-one callout highlight for uniquely matched text. The Three.js canvas is React-owned; HTML translation is disabled to reduce external DOM mutation.

Limitations: exact CAD face anchors and DXF entity ballooning are not implemented. PDF evidence is first-page, unrotated text PDFs with unique exact callouts only. Weld-location detection, consumable consumption, per-component process costing and category-specific automatic process rebuilding still require further implementation/validation. Standard-part classification is heuristic and must be reviewed. Scope changes can rebuild the BOM, so verify any manual purchase rates afterward. Purchase costs require the explicit Apply Purchase Costs button. No browser reproduction of Ongoing crash was possible, so the runtime fix is not confirmed. Full frontend installation/build could not run (uncached npm dependencies); do not replace production until browser/build verification.

Run from backend: `python -m pip install -r requirements-render.txt`, `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`. From frontend: `npm install`, `npm run dev`. Keep existing database environment variables and back up previous folder.

Tests: 21 backend tests passed, Python compileall passed; changed TypeScript/TSX files syntax-transpiled successfully. Full frontend typecheck/build and browser testing pending.
