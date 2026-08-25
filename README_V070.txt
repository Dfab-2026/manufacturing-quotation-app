Manufacturing Quotation v0.7.0 — Engineering Costing Logic

Implemented from the requested workflow:
1. MATERIAL
   - AI extracts material + geometry.
   - For common sheet families, costing uses the smallest internal purchasable blank that can contain the required quantity.
   - 100 x 100 mm part can therefore use the 500 x 500 mm minimum cut-blank assumption rather than charging a complete 1000 x 2000 or 1250 x 2500 sheet.
   - If no reliable material rate exists, the Rate and Amount display blank until the engineer enters a rate.

2. PROCESS
   - Default process recommendation is generated from geometry/features.
   - Sheet/plate -> laser-cut starting recommendation; bends -> press brake.
   - Rotational/cylindrical -> CNC turning.
   - Solid/prismatic -> CNC milling.
   - holes/threads/chamfers add the relevant secondary operations.
   - Process cell is now a Rate-Master-driven dropdown and can be changed by the engineer.

3. PROCESS HOURS
   - Hourly Rate Master rows (CNC Turning, CNC Milling, General Machining, etc.) get an editable deterministic first-pass hour estimate based on overall size, hole/thread/chamfer count, quantity and geometry.
   - This is a quoting starting point, NOT guaranteed machine cycle time. Accurate production cycle time requires actual machine/tooling/feed/setup history.

4. LABOUR
   - Machinist labour follows estimated machining hours where applicable.
   - Fabrication/welding/finishing/QC remain separate editable rows.

5. COMMERCIAL EDITING
   - Material wastage %, overhead %, markup % are editable directly on the cost sheet.
   - Final selling price is editable.
   - Any Rate Master item can be selected from dropdown.
   - Rate, Cost Qty, Unit, Amount remain editable.

6. RATES
   - Pricing is never searched live and silently inserted into quotations.
   - Rate Master is the pricing source. New process types are included with blank/zero approved-rate placeholders where no trustworthy company rate exists.

Research basis used for process-selection logic:
- Protolabs: rotationally symmetric/cylindrical parts are strong CNC-turning candidates.
- Xometry: CNC milling suits prismatic/multi-face parts; turning suits rotational parts; mill-turn is appropriate when both feature types exist.
- Fictiv: sheet-metal fabrication suits uniform-thickness profiles created by cuts, bends and welds.
- Outokumpu/Aalco supplier references show common stainless/aluminium/GI sheet formats such as 1000x2000, 1250x2500 and 1500x3000 mm.

Important: supplier minimum cut size is not globally standardized. The 500x500 blank is therefore an editable commercial assumption for costing, not a universal market rule.
