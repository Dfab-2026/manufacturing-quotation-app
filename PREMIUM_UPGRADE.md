# Premium Quotation Builder Upgrade — v0.14.0

This package preserves the existing four-step quotation workflow and adds a deterministic Premium Estimator layer on top of the existing drawing extraction, Rate Master, DFM/BOM, revision, dataset-learning and quotation-history systems.

## Added
- Premium process routing with setup/run-time estimates.
- Machine + labour Rate Master consumption for process costing.
- Apply Process Costing into the existing cost sheet.
- Quantity-break pricing with setup amortization.
- Drawing-requirement detection (tolerance/GD&T, finish, heat treatment, NDT, welding, coating, material cert, packing).
- Deterministic DFM/risk alerts.
- Confidence/attention summary.
- Similar historical quotation matching.
- Lead-time estimation and expedite planning.
- Margin protection and approval routing.
- Sheet-envelope nesting/utilization estimate.
- Assembly and bought-out item detection.
- What-if commercial scenarios and cost-driver view.
- Actual-vs-quoted feedback storage and learned historical bias.
- Estimator assistant for cost/risk/savings/lead/similar-job questions.
- Approval/revision/reject audit actions in quotation preview.
- Dashboard KPIs for quote value, win rate, learning samples and rate coverage.
- Refined persistent dark theme across legacy and premium UI.
- Hot-cache reads for rates/settings/quotations/actual history to reduce repeat DB latency.

## Model/learning architecture
The drawing model remains evidence-first. Engineer-reviewed exact-file corrections remain reusable, while the Premium Estimator uses historical quotations and saved actual results as retrieval/feedback memory. This avoids claiming unsupported model-weight training while still improving estimating decisions from completed work.

## Verification performed in this environment
- Python compile: backend/app/*.py and backend/app/extraction/*.py — PASS.
- TypeScript/TSX parser/transpile diagnostics for page.tsx, api.ts and types.ts — PASS.
- Premium estimator deterministic smoke test — PASS.
- Full Next.js build could not be completed because `npm ci` timed out before Next.js was installed in the execution environment.
