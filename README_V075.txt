Manufacturing Quotation App v0.7.5

This patch PRESERVES all v0.7.4 default Rate Master values and material/process/
labour costing. It does not remove or replace the existing starter rates.

UPDATES
=======

1) BACK / PREVIOUS PAGE
- Browser/system Back is kept inside the quotation app.
- It goes to the previous app page/workflow step instead of dropping the user
  out of the application.
- Example: Quotation -> Cost Sheet -> Drawing Review -> Upload -> Dashboard.

2) AUTO-SAVED IN-PROGRESS QUOTATION
- The whole active quotation workflow is auto-saved in IndexedDB every ~220 ms.
- Stores:
  uploaded File objects, AI extraction, drawing edits, cost rows, summary,
  current step, customer, batch state, final-price override and commercial
  amount overrides.
- Refresh/reopen on the same browser/device restores the last active step.
- Starting a New Quotation clears the previous active draft.

3) MATERIAL COST QUANTITY
- Material Cost Qty displays as explicit kg, e.g. "0.36 kg".
- It remains a numeric editable field.
- Amount remains Cost Qty × Rate Master rate.
  Example: 0.36 kg × ₹280/kg = ₹100.80.

4) COMMERCIAL SETTINGS
- Material Wastage %, Factory Overhead % and Markup % are no longer editable
  on the cost sheet.
- These percentages are controlled only from Settings.
- COMMERCIAL Rate Master rows remain visible for reference/default preservation but are locked; their Settings button opens the only editable percentage controls.
- Saving Settings immediately recalculates the current sheet.
- On the cost sheet the AMOUNTS for:
    Material Wastage
    Overhead
    Markup
  are editable.
- Final Selling Price remains editable.

5) QUOTATION HISTORY
- A successful PDF/ZIP download automatically creates a "Downloaded" history
  record with backend date/time.
- History now shows:
  Name, Date & Time, Drawing, Customer, Status, Amount, Actions.
- Rename option added.
- Delete option added.
- Existing Save Draft remains available.
- Old history records without a custom name continue to display normally.

6) SEND TO TRAINING POPUP
- Existing v0.7.4 behavior is retained:
  PDF/ZIP downloads first, then "Send to Training?" popup appears.
- Only explicit Send to Training approval creates a curated training sample.

7) SPEED
- Review save + revision snapshot are now sent in parallel.
- AI retry wait reduced from 3.5 s to 1.2 s.
- Existing analyze-summary single-round-trip and 2-drawing batch concurrency
  remain in place.

DEPLOY / LOCAL TEST
===================
Backend:
  python -m uvicorn app.main:app --reload --port 8000

Frontend:
  cd frontend
  npm run dev

TEST ORDER
==========
1. Upload one drawing and analyze.
2. Save Review & Continue.
3. Edit Cost Sheet.
4. Press browser/system Back: should return to Drawing Review, not exit app.
5. Forward to Cost Sheet again: edited data should still exist.
6. Refresh/reopen: should restore the last step/data.
7. Change commercial percentages only in Settings and Save.
8. Cost Sheet should show the new percentages read-only; amounts editable.
9. Generate PDF.
10. Confirm "Send to Training?" popup appears.
11. Open Quotation History; downloaded quote should show date/time.
12. Test Rename and Delete.
