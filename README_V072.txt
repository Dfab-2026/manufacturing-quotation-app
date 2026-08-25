Manufacturing Quotation App v0.7.2 — Rate Master Dropdown Update

FOCUSED UPDATE
==============
This patch keeps all v0.7.1 engineering/material/process/labour costing logic
and changes the Rate Master to be dropdown-first.

RATE MASTER
===========
- Process is a dropdown (not free typing).
- Labour Type is a dropdown (not free typing).
- Material is a dropdown.
- Material Grade is a dropdown.
- Unit is a dropdown in both Rate Master and the engineering cost sheet.
- Units now include:
  sec, min, hr, shift, day, job, setup, each, piece,
  kg, g, ton, mm, m, m2, m3, hole, stud, bend, cut, weld, %.
- '+' buttons allow an engineer to add a new custom process, labour type,
  material or unit when the standard dropdown does not contain it.
- Once that new Rate Master row is saved, it becomes part of future dropdowns.

RATE MASTER IS THE COSTING SOURCE
=================================
When a saved Rate Master row is linked to a current engineering cost row,
saving the Rate Master row immediately reapplies:
- item/process/labour name
- unit
- rate
- amount
to the cost sheet.

TIME UNIT CONVERSION
====================
Auto-estimated machining/labour time is calculated internally in hours, then
converted to the Rate Master unit:
- 2 hr -> 120 min
- 2 hr -> 7200 sec
- 2 hr -> 2 hr
If a timed rate is changed to a fixed per-job unit, costing quantity becomes 1.

This means changing CNC Turning from ₹/hr to ₹/min in Rate Master does not
mistakenly treat the old hour quantity as minutes.

CUSTOM PROCESS DETECTION
========================
If Vision AI returns the exact name of a user-added PROCESS in Rate Master,
the backend will use that Rate Master ID/rate automatically.

START
=====
Backend:
python -m uvicorn app.main:app --reload --port 8000

Frontend:
cd frontend
npm run dev
