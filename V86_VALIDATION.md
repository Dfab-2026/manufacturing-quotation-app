# V86 — Strict product drawing extraction

- Ruled content boxes excluded from geometry extraction and source evidence, including raster drawings.
- Empty optional Locate rows omitted; core dimensions retained.
- Original V85 archive entries preserved; six existing files changed and one regression test file added.
- Backend regression: 81 passed (13.23s).
- Frontend locator: 14 passed.
- OCR smoke test: Tesseract recognition passed.
- Full Next.js build/typecheck/lint not verified: npm uncached undici-types dependency.
- Live deployment and unusual drawing layouts require verification.
- Temporary local SQLite database excluded.
