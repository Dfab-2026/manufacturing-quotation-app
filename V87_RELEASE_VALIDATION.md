# V87 — API routing stability and release validation

Base: V86 strict drawing-only extraction. Existing drawing extraction, source markers, UI, Rate Masters, BOM, costing, saved quotation data models and Render OCR settings are retained.

## Changes

- Shared API routing selects one direct backend for normal operations. On localhost it uses the local FastAPI URL (default http://127.0.0.1:8000), even when production environment variables are present. Configure a loopback NEXT_PUBLIC_API_BASE_URL for a custom local port. No automatic local-to-production fallthrough. On a deployed domain it uses the configured public backend or the existing Render default. Explicit `/backend-api` proxy mode remains available for custom deployments.
- This avoids the typical Next.js internal HTTP-proxy `util._extend` deprecation path without suppressing Node warnings or editing node_modules. The reported log alone does not prove the exact call stack. If the warning persists, run `node --trace-deprecation node_modules/next/dist/bin/next dev -p 3000` and inspect it.
- CORS allows local IPv6 origin and exposes Content-Disposition for direct downloads.
- Release preparation automates the supported Next 15 + React 19 migration, regenerates the lockfile from npm, and checks build, TypeScript, both frontend unit suites and high/critical npm vulnerabilities. It restores the original manifests if any command fails. The original dependency lock is preserved in this ZIP because the npm registry cannot be reached in the verification environment.
- CI and Vercel build configuration run the release check. They intentionally reject the old Next 14 lockfile. Complete release preparation before pushing. No forced npm audit fixes, ignored peer dependencies or warning suppression.

## Local verification and deployment

Use Node 22 or 24 LTS and Python 3.12.10 for the deployed backend. From frontend, run:

```
npm run release:prepare
```

The command must complete successfully. If it fails, inspect its error; the original manifests are restored. `npm ci` restores the previous local dependencies if needed. Do not publish the unupgraded lockfile. Next 15 is a transitional maintenance branch (security support currently extends through January 31, 2027); plan a separately tested Next 16 migration.

Then test the actual browser workflow: upload PDF, DXF and STEP, Analyze, Locate, Review, DFM, BOM, Cost Sheet, Export Excel/PDF, save, refresh, History, Ongoing, Rate Masters. Commit the updated manifests as well as these sources. Deploy the backend first, using the existing Render build/start commands and DATABASE_URL. Verify `/api/health` and `/api/ocr/health` on Render. Deploy the frontend with Root Directory `frontend`, Node 22.x and the existing API variables pointing at the backend URL. If the Vercel dashboard overrides the repository build command, set it to `npm run release:check`.

## Verification performed in this session

- `python -m pytest -q tests` in backend: 83 passed (includes two new CORS tests), temporary SQLite database outside the project.
- Node frontend tests: 20 passed (14 locator + 6 routing).
- TypeScript strict isolated check of actual `lib/api.ts` and `lib/apiRouting.ts` with global TypeScript and a temporary minimal process.env declaration: passed. This is not a full Next.js type check.
- `python verify_runtime.py --require-ocr`: passed using Tesseract optical reader.
- Node syntax checks of new release scripts: passed.
- Full dependency install: failed because npm registry DNS resolution is unavailable. Production dependency upgrade, full Next build, full project TypeScript/lint, runtime trace, actual browser and deployed Supabase/ONNX validation remain unverified. No standalone ESLint configuration exists in V86. Do not treat this ZIP as an already certified production release.

## Public deployment security gates

Next.js 14 is unsupported. The release check requires at least 15.5.29 or 16.4.5 and rejects high/critical npm audit results. Current security advisory review remains necessary. The app's existing unauthenticated shared-data architecture is not safe for unrestricted multi-tenant public use. Keep the application access-restricted until authentication, authorization, tenant isolation, storage protection, rate limiting, backups and real deployment tests are verified. CORS is not authentication. Preserve database credentials outside Git. Review existing historical/private reference files before pushing to any publicly accessible repository.

References: https://github.com/vercel/next.js/issues/74460 ; https://nextjs.org/support-policy ; https://nextjs.org/docs/app/guides/upgrading/version-15 ; https://www.netlify.com/changelog/2026-11-03-nextjs-security-vulnerabilities/
