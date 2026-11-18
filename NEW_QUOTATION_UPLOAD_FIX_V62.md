# V62 New Quotation Upload Page Fix

Targeted change only.

- New Quotation still preserves the current quotation using the existing Draft / Incomplete flow.
- After preservation, navigation is explicitly forced to `view = workflow`, `step = 1`.
- Autosave is temporarily suppressed during the reset render so the previous step cannot be reapplied.
- The page scrolls to the top of the upload workspace.
- Existing Ongoing diamond, Draft restore, STEP/PDF analysis, preview, costing, History, and other flows are unchanged.
