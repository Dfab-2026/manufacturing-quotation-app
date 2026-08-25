Manufacturing Quotation App v0.9.7

Requested workflow corrections:

1. DFM page
- only DFM source selector is shown
- BOM source selector removed from DFM page

2. BOM page
- BOM source selector is shown on the BOM page only

3. Diamond button
- strictly opens the current ongoing quotation
- it uses current in-memory workflow or the active draft only
- it never restores an older workspace/history item

4. Single ongoing quotation rule
- clicking New Quotation automatically deletes the previous ongoing workspace
- previous active IndexedDB workspace is deleted
- previous active backend workspace/session is deleted
- a new workspace ID is created
- old saved quotation HISTORY records are not deleted

5. End Process
- End Process button added to the ongoing Source Overview
- no confirmation popup
- clicking it deletes the current ongoing process and returns to fresh upload
- active DFM/BOM artifacts for that process are removed
- quotation history remains untouched

6. Removing the final uploaded source
- treated as ending the current process
- fresh quotation/upload state is created automatically

All other analysis, CAD, costing, DFM/BOM content, cursor, sidebar and premium UI remain unchanged.
