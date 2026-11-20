# V76 targeted update (V75 base)
- Workbook-mapped unit prices are refreshed in Rate Master once and can be reapplied using Apply Excel Rates. Custom unrelated rows are retained. Historical totals are not treated as rates.
- Explicit thickness, pipe OD/ID wall calculation and source-supported flat-plate estimates; unsupported dimensions require review rather than invented values.
- PDF multiple source matches show candidate/verified markers and page navigation. DXF rendered evidence and STEP geometry markers are wired to Locate. Missing source coordinates are reported, not fabricated.
- Durable local SQLite, portable JSON storage; deployed PostgreSQL still requires a valid DATABASE_URL.
- Targeted drawing card spacing.

Validation: 34 backend tests passed; Python compileall and changed TypeScript/TSX transpilation passed. Full Next.js production build, lint, typecheck, browser marker alignment and live Supabase connectivity not verified. STEP/DXF/OCR source coverage varies by input; existing saved drawings without originals cannot be reconstructed. No assertion of universal thickness or source-location accuracy.
