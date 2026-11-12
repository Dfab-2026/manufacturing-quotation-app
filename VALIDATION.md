# Validation Report — Reconstructed Baseline

## Passed

- Python source compilation: PASS
- Existing focused extraction tests: 4/4 PASS
- Frontend TypeScript static type/syntax check with local module stubs: PASS
- Backend health endpoint: PASS
- Settings endpoint: PASS
- Rate Master endpoint: PASS
- Cost calculation endpoint: PASS
- DFM generation endpoint: PASS
- BOM generation endpoint: PASS
- Review save endpoint: PASS
- Quotation save endpoint: PASS
- Quotation history endpoint: PASS
- DFM PDF export: PASS
- BOM PDF export: PASS
- Full simulated workflow (Analyze -> Review -> DFM/BOM -> Cost -> Quote -> History): PASS

The analysis simulation uses a deterministic mocked AI response so the application workflow can be verified without consuming Gemini quota.

## Not verified in this environment

- `npm run build`: package installation could not complete within the available registry timeout, so a full Next.js production build was not executed here.
- Live Gemini request with the user's private API key/quota.
- Live production PostgreSQL provider connection.

Run `npm install && npm run build` in `frontend/` before deployment.
