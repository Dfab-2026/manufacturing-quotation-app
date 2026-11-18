# Ongoing quotation fix v55

- Replaced the small diamond-only ongoing control with a clearly labelled **Ongoing** button beside **New Quotation**.
- The button is always visible and shows an active green indicator while there is a current unfinished quotation.
- Ongoing detection now also considers analyzed costing rows, not only uploaded File objects.
- Clicking **Ongoing** reopens the current in-memory quotation or restores the saved active workflow from IndexedDB/workspace storage.
- End Process/New Quotation behavior is unchanged: ended work moves to Draft / Incomplete and is resumed from Quotation History, not Ongoing.
- STEP/CAD analyzer, preview, PDF flow, costing, history, and other existing flows are unchanged.
