# V90 — Release pipeline and transitive dependency repair

## Scope
V89 is the source baseline. Application UI, all drawing analysis/extraction, source coordinates, prediction, costing, BOM, database and backend files remain byte-for-byte unchanged. This patch changes only frontend deployment scripts, metadata, and release tests.

## What the supplied Vercel output actually establishes
The `MODULE_TYPELESS_PACKAGE_JSON` message is a warning. The shown routing test passes. The excerpt does not include the failing command or error immediately preceding Vercel's generic `release:check exited with 1`. Therefore the exact previous deployment failure cannot be established from the excerpt alone.

## Corrections
- Declare the frontend package as ESM (`type: module`), since the source and all frontend scripts use ESM. This eliminates the reported module-type warning without disabling warnings globally.
- Require patched PostCSS >= 8.5.23 within 8.x, and Sharp >= 0.35.5 within 0.x, through npm overrides; validate every occurrence in the resolved lock (including nested copies). Sharp is an optional dependency on some platforms; if present in the lock it must satisfy the security floor. These address independently identified vulnerable dependencies, not a confirmed diagnosis of the truncated Vercel failure.
- Preserve the Next.js 15.5.29 or newer supported branch policy, React 19.3.1 migration, Node 22.x runtime selection, and npm lockfile/install checks. Do not use `npm audit fix --force`, ignore build failures, or disable TypeScript checks.
- Run all release checks as labeled stages. Audit before the production build. The process stops on a failed stage and propagates its exit code. A passing unit test no longer obscures the identity of later failed commands.

Security references: https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp and https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw .

## Deployment
Use Vercel root directory `frontend`, Node.js 22.x, Install Command `npm run release:install`, Build Command `npm run release:check`. No Render or Supabase configuration change is required for this frontend deployment issue. Clear the existing Vercel build cache on the first deployment after updating.

Before pushing, run inside frontend:
```
npm run release:prepare
```
This performs the real dependency migration, regenerates the lockfile from npm registry metadata, and runs all validation stages. Commit both generated package.json and package-lock.json after success. Never hand-edit integrity hashes or deploy the unsupported Next.js 14 seed. The ZIP retains the authentic V89 lockfile as a migration seed because npm registry access was unavailable in this test environment. `npm run release:install` is mandatory for the first installation.

## Actual verification results
- Backend: 83 passed (13.17s, Python 3.13.5 in this test environment; deployment configured for Python 3.12).
- Frontend release orchestration: 11 passed (includes simulated transitive security checks and stage exit propagation).
- Drawing locator: 14 passed.
- API routing: 6 passed.
- Strict standalone TypeScript check of apiRouting.ts and drawingLocator.ts: passed.
- JavaScript syntax checks: passed.
- Actual release attempt (Node 22.16.0): FAIL at stage 1, npm registry DNS EAI_AGAIN. Original manifests restored. Real dependency installation, npm advisory audit, full Next.js compilation, whole-app type checking/lint and live deployed smoke tests remain unverified. The stage-orchestration tests use simulated npm, Next.js and TypeScript processes; they do not establish production-build success.

This is a targeted release candidate, not a certified error-free deployment. If Vercel fails, use its first `[release FAILED n/8]` line and the preceding actual error to isolate the cause.
