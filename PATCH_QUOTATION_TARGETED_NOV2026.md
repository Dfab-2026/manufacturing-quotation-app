# Targeted changes in uploaded base app

Base: manufacturing-quotation-app-main(2).zip (user-provided)

Only changed:
- frontend/app/page.tsx
- frontend/app/globals.css

Quotation commercial amounts remain editable. Three percentages (material waste, factory overhead, markup) are now also editable directly within the quotation cost summary. Quotation-specific percent changes recalculate through the existing backend, clear the matching manual amount override, and automatically save in the existing workflow draft/dataset state. Global company Settings are not overwritten by changes to an individual quote.

Rate Master: editing an existing rate row schedules an automatic backend save after 650ms without needing the Save button; Save is preserved as an immediate retry. Saves are ordered per row and existing costing rows are refreshed using the established API.

Review Attention: a missing-rate warning's Go control moves to the cost rate grid. Once all costing rows have valid positive rates and costing quantities, missing-rate warnings are suppressed in the review display, while unrelated drawing/geometry warnings remain. A row with a positive rate is no longer red merely because its extraction confidence was previously 'Assumed'; its status becomes Review instead.

Unchanged: backend, database/data, extraction, PDF/Excel export, CAD/DFM/BOM, history, navigation, security, env configuration, and project structure.

Validation notes: frontend TSX syntax parse and backend Python compilation pass. Full Next.js build/typecheck couldn't be completed in this environment because npm dependency installation failed. Live production/backend API integration was not exercised.
