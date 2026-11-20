# V85 — Locate provenance and complete measurement rows

Base: V84. Only the interactive drawing evidence table, its source-anchor logic, CSS and targeted tests changed.

Measurement rows retain clean names and distinguish Verified, Predicted, Calculated, Source unverified, Review required and N/A. Missing measurements remain visible. Additional numeric feature measurements include hole depth, bend/chamfer angle, thread depth, stud length and weld size/length. Source markers require compatible actual drawing evidence; no fabricated coordinates. Existing predictions are labelled, not invented. Missing non-applicable fields are not automatically predicted. Saved evidence is refreshed to version 9.

Validation: 78 backend tests passed; 14 locator tests passed; strict locator library TypeScript check passed; changed TSX transpilation had zero diagnostics. npm ci --offline failed because undici-types 6.21.0 is not cached, so full Next.js build, application-level browser regression, and live deployment were not verified. Additional features without an actual matching source callout may show Source unverified.
