# V57 Ongoing quotation cache reliability fix

Only the Ongoing/New Quotation cache flow was changed.

- Restored animated diamond remains unchanged.
- Clicking New Quotation first writes the exact current workflow to a dedicated Ongoing cache.
- Full snapshot (including uploaded File objects) is stored in IndexedDB.
- Analysis/rows/costing/navigation also receive a localStorage JSON fallback.
- The new quotation reset is blocked if neither cache layer confirms persistence.
- History/Draft API saving remains secondary and cannot erase or block the local Ongoing snapshot.
- Clicking the diamond restores the suspended snapshot first, then promotes it back to the normal active draft.
- Existing STEP/PDF analysis, costing, history, Draft, and UI flows are unchanged.
