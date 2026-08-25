Manufacturing Quotation App v0.8.2

Focused UI update. All v0.8.1 speed, costing, DFM, BOM, history, training and
default Rate Master behavior remains unchanged.

DFM / BOM LEFT STATUS LIGHT
============================
RED:
- Initial state / no active drawing loaded.

YELLOW BLINK:
- A drawing has been uploaded.
- Drawing review / analysis workflow is still before the Engineering Cost Sheet.

GREEN:
- Engineering Cost Sheet (Step 3) has been reached and costing rows are ready.

The old long status badge/bar is replaced with one compact round light.
A separate small neutral number shows saved DFM/BOM history count.

DFM DASHBOARD
=============
Cleaner KPI area:
- Drawing
- Manufacturing Type
- DFM Status
- Passed Checks
- Review count
- Failed/Blocking count

Unknown/review/fail conditions are visibly marked.
FAIL = red row.
REVIEW = yellow row.
An attention banner shows how many items need engineer review.

BOM DASHBOARD
=============
Cleaner KPI area:
- Drawing
- Total Items
- Material Lines
- Standard/Purchased Parts
- Missing/Review count
- Total BOM Cost

Rows missing important data are marked red.
BOM remains fully editable.

CURSOR
======
The same cursor is used everywhere in the app.
New cursor design = Indian Rupee symbol ₹ inside a clean circular icon.

No other workflow changes in this patch.
