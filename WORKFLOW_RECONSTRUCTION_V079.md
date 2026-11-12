# Workflow Reconstruction v0.7.9

This build reverts the v1.0 redesign and keeps the original Manufacturing AI Quotation UI.

Only the workflow internals were reconstructed:

1. Upload drawing(s)
2. Analyze drawing only
3. Drawing Review
4. Save Review & Continue opens Step 3 immediately
5. Review persistence runs independently
6. DFM and BOM start only after review and run in parallel
7. Engineering & Cost Sheet
8. Quotation / history

## Key reliability changes

- Analysis no longer starts DFM/BOM jobs before engineer review.
- Analyze returns drawing extraction/cost rows only, reducing analysis work and backend contention.
- Save Review & Continue transitions to Step 3 synchronously before storage/network/report work.
- Local draft, workspace dataset, and server review saves are independent and cannot send the UI back to Step 2.
- DFM and BOM generation are independent; one failure does not block the other or quotation editing.
- Revision/dashboard synchronization remains best-effort and never blocks the workflow.
- Original UI, Rate Masters, costing, percentages, history and export functionality are preserved.

## Verification performed

- Python compile: PASS
- Backend focused tests: 4/4 PASS
- TypeScript syntax check on changed files: PASS
- Clean npm install/full Next.js build: not completed in the execution environment because npm registry installation timed out.
- Live Gemini and production database end-to-end verification still requires the user's environment/keys.
