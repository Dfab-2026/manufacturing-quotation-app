# V61 targeted fix

Only two areas changed from v60:

1. STEP/CAD dimension table removes redundant Overall Width/Height/Length values when the same physical envelope is already represented by Overall X/Y/Z. Pricing-relevant OD, ID, thickness and verified feature dimensions remain.
2. New Quotation now saves a local Draft/Incomplete + exact IndexedDB preview/source snapshot first, resets immediately, then syncs that Draft to FastAPI in the background. Ongoing/diamond merges local and server drafts so it can resume the latest draft even while backend sync is unavailable.

All other flows are unchanged.
