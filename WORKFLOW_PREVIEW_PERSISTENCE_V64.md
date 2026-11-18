# V64 Workflow Preview Persistence

Targeted update only. Existing analysis, costing, Ongoing, Draft/History, STEP extraction and UI flows remain unchanged.

- Uploaded source files now have quotation-lifetime references.
- Normal Step 1/2/3/4 navigation and browser Back do not clear the active preview source.
- PDF/image preview uses the durable active source rather than only transient primary-file state.
- STEP/CAD viewer continues to use the active durable source.
- Autosave snapshots fall back to the durable source if transient file state is briefly empty.
- Source references are cleared only by explicit file removal, New Quotation reset, or End Process/completion.
