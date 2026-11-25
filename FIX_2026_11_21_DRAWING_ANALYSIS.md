# Drawing Snapshot & Basic Details – targeted fix (2026-11-21)

Base: the user's supplied `manufacturing-quotation-app-v90-release-pipeline-fix (1).zip`.

## Diagnosed from the supplied production logs

1. A legacy `/api/review` / `/api/review/current` insert tried to upsert into the **tenant-scoped ERP `drawings`** table without `tenant_id`. PostgreSQL raised `NotNullViolation`; because review and cache insert shared a transaction, the valid review was rolled back. The API returned `status: deferred` despite HTTP 200.
2. The browser's `Failed to fetch; fallback service: Failed to fetch` means neither the analysis nor fallback backend responded successfully; the existing UI then labeled a fabricated client-side review as completed. RapidOCR initialization followed by a server restart was observed, but **the provided log does not include the reason for termination**. Memory pressure is a plausible contributing factor on a 512 MiB Render instance.

## Exact fixes and preserved flows

- `backend/app/db.py`: Detect the tenant ERP table. Do not upsert legacy drawing-cache rows into it or apply legacy additive migrations to ERP-owned `drawings`; continue saving review/extraction JSON and review cost rows to their own tables. The standalone legacy drawing cache continues working unchanged.
- `backend/app/extraction/ocr_runtime.py`, `backend/app/main.py`: Protect the API process from launching all RapidOCR/ONNX models below 768 MiB container RAM. Still analyze native PDF text, PDF evidence and deterministic engineering fields. Clearly disclose that optical fields need review when local OCR cannot run. OCR remains available on a sufficiently large instance.
- `render.yaml`: Add memory guard and single-thread inference defaults; validate dependencies during build without forcing heavy OCR inference to run in the build container. Runtime OCR can still be validated via `/api/ocr/health` when memory permits.
- `frontend/lib/api.ts`: Bounded retry of transient service/network errors during drawing analysis; no retries for invalid requests.
- `frontend/app/page.tsx`: Avoid forcing OCR on every vector PDF. The backend still runs OCR automatically when needed and available. Serialize drawing analyses to avoid simultaneous memory-hungry work. When **both** analysis and fallback are network-unreachable, keep the uploaded source in the existing failure/retry flow rather than silently saving empty predicted data as a successful drawing.
- No navigation, screens, visual styles, quotation rates, DFM/BOM, drafts, history, STEP viewer, or unrelated flows were modified.

## Deploy

1. Deploy this project's `backend` directory to the existing Render service (the supplied `render.yaml` is the source of truth) and set its existing `DATABASE_URL`. Deploy the **same** `frontend` directory to the existing Vercel project.
2. Keep Vercel's `NEXT_PUBLIC_API_BASE_URL` pointing to the existing HTTPS Render backend. The original fallback is `https://ai-quotation-api.onrender.com`. Local frontend remains port 3000 and local FastAPI remains port 8000.
3. On 512 MiB Render plans, PDF *native text* extraction remains available while intensive ONNX OCR is suppressed. For optical reading of scanned/image-based engineering drawings, use **at least 1 GiB RAM** (more if handling large sheets) and keep `LOCAL_OCR_ENABLED=true`, `OCR_MIN_MEMORY_MB=768`; check `/api/health` and `/api/ocr/health`. The extra RAM is a requirement for full OCR and cannot be guaranteed by code alone.
4. Re-upload the drawing and select **Analyze**. If the backend is offline, use the existing **Retry Failed** flow after it recovers. Verify `/api/review` or `/api/review/current` returns `status: saved` (not merely HTTP 200). Verify that existing quotation history and rates are unaffected.

## Validation run in the packaging environment

- Backend unit/integration: 87 tests passed; includes a tenant-ERP-table regression, standalone-cache regression, 512 MiB memory guard regression, and an actual vector-PDF `/api/analyze` request.
- Python syntax compilation: passed.
- `backend/verify_runtime.py` (without OCR inference): passed in this environment.
- Frontend routing tests: 6 passed; drawing locator tests: 14 passed; release orchestration tests: 11 passed.
- Changed TSX/TS files: TypeScript parser/transpiler syntax checks passed.
- **NOT verified:** frontend Next.js production build, complete TS typecheck, vulnerability audit, and live Render/Vercel deployment. This packaging environment could not connect to `registry.npmjs.org` (`EAI_AGAIN`), and the archive does not ship `node_modules`. Its existing release-check pipeline must be run in a network-enabled environment prior to production deployment (`cd frontend && npm run release:check`). Do not treat this ZIP as a verified production release until that build passes.
