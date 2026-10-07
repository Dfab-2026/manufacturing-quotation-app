# Weight Priority + Speed Fix

## Weight source priority
1. Explicit drawing/title-block weight (WEIGHT / WT / MASS / NET WEIGHT / UNIT WEIGHT) is authoritative.
2. g and lb values are normalized to kg.
3. If no explicit weight exists, deterministic geometry prediction is used from dimensions/CAD geometry, thickness, material density and quantity.
4. Drawing/Part Summary weight remains the engineering base weight. The 1 kg material allowance stays separate and is applied only to costing.

## Speed improvements
- Removed artificial per-drawing frontend delay.
- Exact-hash extraction cache reuses the latest successful extraction when no engineer review exists.
- Engineer-reviewed exact-hash data remains highest priority.
- Existing embedded quote summary/DFM/BOM response is reused to avoid extra analysis calls.

## Verification
- backend Python compile: PASS
- frontend TS/TSX transpile syntax: PASS
- npm production build: NOT completed because dependency installation timed out in the execution environment.
