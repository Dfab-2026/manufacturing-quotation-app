# v34 Cost Sheet + UI workflow update

Targeted changes only. Existing extraction, Analyze, Render/Vercel deployment, quotation, DFM/BOM and unrelated flows are unchanged.

- Cost Sheet autosave debounce reduced to 180 ms and now persists summary + commercial overrides.
- Weight/material allowance changes immediately trigger recalculation and autosave.
- Missing manual rate entry recalculates totals first, then asks whether to save the rate to Rate Master.
- Missing-rate Attention panel includes Go buttons that open Rate Master filtered to the affected row.
- Desktop Cost Sheet cards are grouped visually and kept single-line where space allows.
- Upload page uses a fixed two-column desktop workspace: upload left, scrollable source queue right, analyzer at bottom.
- Ongoing quotation resume is now a separate animated Continue here control.
