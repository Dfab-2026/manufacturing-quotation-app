# V45 targeted updates

Only the requested areas were changed from v44.

- Commercial defaults for a new/current costing session: Material Wastage 10%, Factory Overhead 20%, Markup 30%. All remain editable.
- One-time frontend migration applies the new 20%/30% defaults to existing legacy settings and saves them back through the normal Settings API.
- Analysis now uses a resilient chain for every uploaded source: normal PDF/image/DXF/DWG or CAD analysis -> backend predicted fallback -> final client predicted fallback. A source no longer blocks the workflow just because exact extraction fails.
- Added WEBP/BMP/TIF/TIFF to the accepted image formats.
- Every analyzed-source card has an X control that removes only that source and its linked active artifacts.
- End Process saves current quotation items to Quotation History as Draft / Incomplete, then clears the active workspace.
- The ongoing diamond resumes only a real active workspace. It does not automatically reopen Drafts from History after End Process; those drafts are continued from Quotation History.
- All other UI, costing, history, Rate Master, DFM/BOM, extraction and navigation behavior is preserved.
