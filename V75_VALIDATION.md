# V75 — Targeted RFQ corrections (verification build)

Base: V74 manual RFQ rates. Original uploaded workbook copied into V74 was byte-for-byte identical to the supplied workbook (SHA256 4edb0548c7dedc07d8f27fff4f3ef8ea29eab09610beaf6f6c453ce6aa6222b7). No reset of custom rates or existing database data. The private_reference folder remains gitignored; keep it private.

Changes:
- Recover original PDF image and source anchors on demand if older saved analysis lacks the raster, provided original file is still available. New PDF analyses return the image as well as source anchors. Named length/thickness/radius/etc. references can match within an explicit callout. Ambiguous references are not highlighted.
- Recognize nested pipe classification and additional hollow cylindrical forms, derive wall thickness from unique OD/ID, recover explicit printed thickness in PDF and preserve engineering-reviewed memory. Conflicting or unavailable thickness remains unresolved. Added SS304/SS316 density aliases. No universal thickness guess.
- Drawing Review customer/project name, blank unknown weight, bottom continue action, hide technical source badge. Existing workflow remains.
- Cost Sheet removes manual saved-rate refresh and pending label; existing autosave remains. Failed database synchronization is disclosed; success is not displayed until backend reports saved.
- Excel export retains cost rows and commercial values and includes available engineering features, processes, BOM, assembly parts, customer and scope in additional tabs. User-controlled Excel strings escaped. Exports current active drawing, not a comprehensive batch workbook.
- BOM retains aggregate raw material allowance for assemblies when a material cost row exists and recognizes explicit quantity-prefix purchase callouts. No supplier quantities are guessed beyond pre-existing heuristics. Purchased images remain existing reference images, not verified supplier products.
- Quotation layout styling updated without replacing the editable grid. No new dependency needed.

Validation: 34 backend tests passed, including API PDF analyze, recovery endpoint, workbook export, wall calculation, and existing workspace storage tests. Python compile and TS/TSX transpilation passed. npm ci offline failed (undici-types missing from cache); online install timed out. Production Next build, full typecheck, lint and live browser regression not verified. Actual deployment not attempted.

Remaining work: exact STEP/DXF feature highlighting, exhaustive assembly BOM and independent multi-drawing page grouping, complete supplier-stock validation/nesting, reliable recovery of original files that were never saved, all possible PDF layouts/scans, full settings expansion, comprehensive in-app notification conversion and browser verification. This is not a fully validated production release. Do not claim 100% extraction accuracy. Use actual RFQ files for acceptance testing.

Engineering reference: https://www.xometry.com/how-xometry-works/request-a-quote/ and https://www.etmmfg.com/wp-content/uploads/Estimating-Sheet-Metal-Fabrication-Costs-v3.pdf (assembly package review, purchased material, labour, overhead). Rates are based on the supplied workbook rather than public example prices.
