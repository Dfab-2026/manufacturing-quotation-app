Manufacturing Quotation App v0.7.1 — Default Rate Master + Engineering Costing

This version keeps ALL v0.7.0 updates:
- AI drawing feature extraction
- Material / Process / Labour costing split
- practical purchase-blank material costing instead of full-sheet overpricing
- automatic manufacturing process recommendation
- editable process dropdown
- editable cost quantity / hours / unit / rate / amount
- editable material wastage %, overhead %, markup %
- editable final selling price
- CNC/General machining time estimation
- separate machine/process and labour cost rows
- Neon PostgreSQL + Vercel backend support

DEFAULT STARTER RATES
=====================
Materials (₹/kg)
- SS 201: 210
- SS 202: 225
- SS 304: 280
- SS 304L: 295
- SS 316: 380
- SS 316L: 400
- SS 321: 410
- SS 430: 190
- Mild Steel E250: 70
- Mild Steel E350: 78
- ASTM A36: 75
- S355J0 / 1.0553: 85
- Aluminium 5052-H32: 310
- Aluminium 6061-T6: 340
- Aluminium 6082-T6: 360
- GI DX51D+Z: 95
- Copper C110: 780
- Brass C260: 520

Processes
- Laser Cutting: ₹450/job
- Press Brake: ₹350/job
- TIG Welding: ₹250/m
- MIG Welding: ₹180/m
- Stud Welding: ₹50/stud
- Grinding & Flush: ₹350/job
- Deburring: ₹150/job
- Drilling: ₹15/hole
- Polishing: ₹600/m²
- Passivation: ₹500/job
- Powder Coating: ₹300/m²
- Inspection & Handling: ₹150/job
- General/Tack Welding: ₹300/job
- Saw/Raw Stock Cutting: ₹200/job
- CNC Turning: ₹650/hr
- CNC Milling: ₹800/hr
- Manual Milling: ₹550/hr
- General Machining: ₹700/hr
- Drilling/Boring: ₹350/job
- Threading/Tapping: ₹250/job
- Chamfering: ₹120/job
- Shearing: ₹250/job
- Plasma Cutting: ₹500/job
- Waterjet Cutting: ₹800/job
- Hand Grinding/Cut-off: ₹350/hr

Labour
- Fabricator: ₹350/hr
- TIG Welder: ₹450/hr
- MIG Welder: ₹400/hr
- Machinist: ₹500/hr
- Machine Operator: ₹350/hr
- Welder/Fabricator: ₹400/hr
- Finishing Operator: ₹300/hr
- QC/Handling: ₹250/hr

Commercial defaults
- Material Wastage: 8%
- Factory Overhead: 12%
- Profit / Markup: 15%

IMPORTANT
=========
These are editable STARTER quotation rates, not live supplier/vendor prices.
Rate Master remains the source used by costing. Update them with your approved
company/vendor rates whenever available.

DATABASE BEHAVIOUR
==================
Existing zero-valued rows that were previously marked "ENTER APPROVED..." will
be upgraded to these starter defaults when ensure_data runs, because the new
default entries now have non-zero prices.

Restart backend after replacing:
python -m uvicorn app.main:app --reload --port 8000
