# V66 — Drawing Preview + Immediate History Persistence

Targeted changes only:

- Drawing Review stays mounted while moving to Cost Sheet / Quotation, so STEP WebGL preview is not destroyed/recreated during normal step navigation.
- A quotation-lifetime preview File reference is used for STEP/PDF/image rendering and restored when continuing Draft / Ongoing.
- PDF/image object URLs are created from the durable drawing preview source.
- End Process writes a local Draft / Incomplete History record and its exact File-backed snapshot before clearing the active workflow.
- End Process no longer deletes the local File-backed workspace dataset required for Draft preview continuation; backend workspace cleanup remains best-effort.
- Existing New Quotation local-first Draft behavior is preserved.
- No other workflow, analyzer, costing, STEP extraction, Ongoing selection, UI, or quotation logic was intentionally changed.
