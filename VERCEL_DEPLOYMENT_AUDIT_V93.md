# V93 — Vercel deployment configuration audit of v92

## Change boundary

**Application source, API flow, database, UI, drawing/CAD/DFM/BOM/costing, drafts, history, packages, both lockfiles, and the existing `frontend/vercel.json` are preserved byte-for-byte.** This package updates only deployment guidance, extends the existing release regression tests with two Vercel-configuration checks, and adds this report.

## Confirmed from the v92 archive

| Item | Finding | Impact |
|---|---|---|
| Vercel project | `frontend/vercel.json` exists, `framework` is `nextjs` | Correct, **if** dashboard Root Directory is `frontend` |
| Install | `npm run release:install` invokes `npm ci --include=dev` for a ready committed lock | Reproducible: no automatic upgrades on deployment |
| Build | `npm run release:check` runs policy/tests/audit/Next build/TypeScript | Correct pipeline, not yet successfully executed with real dependencies |
| Runtime | Node `22.x` in root and frontend package manifests, `.nvmrc = 22` | Consistent |
| Output | No `outputDirectory` override | Correct Next.js auto-detection |
| Browser API | Public env variables are read by `frontend/lib/api.ts`; browser defaults to a particular Render origin | Confirm Vercel dashboard points at the **intended** backend |
| Legacy proxy | `/backend-api/:path*` rewrites to `FASTAPI_INTERNAL_URL` / known Render origin | Not the normal browser request path; tested without changing it |
| **Committed dependency lock** | `frontend/package-lock.json`: Next.js **14.2.35**, React **18.3.1**, PostCSS **8.4.31** | **CONFIRMED deployment blocker.** Release policy requires patched Next 15.5.29+, React 19, PostCSS 8.5.23+ |

## Required one-time fix before Vercel can deploy

From a Windows PowerShell terminal on a computer that can reach npm:

```powershell
cd frontend
node --version             # Must be Node.js 22.x here
npm run release:prepare    # Migrate manifest, resolve authentic lockfile, install, run full gates
npm run build              # Confirm same pinned dependencies pass again
npx tsc --noEmit
```

`release:prepare` deliberately restores original manifests if any stage fails. If it fails, inspect the **first** error and fix that cause; do not manually fabricate package-lock integrity hashes, disable the security policy, or deploy the old graph. Commit **both** `frontend/package.json` and `frontend/package-lock.json` in the same commit after a successful run. The npm registry was unreachable (`EAI_AGAIN`) in this verification environment, so no lockfile migration or complete Next.js build could be honestly verified here.

## Vercel Project Settings (dashboard, not controlled by the ZIP)

1. Import the Git repository containing `frontend`, not an unrelated older deployment branch. **Root Directory: `frontend`** (not project root, not `apps/web`).
2. Framework Preset: **Next.js**. Node.js Version: **22.x**. Output Directory: **no override**.
3. Install Command: **`npm run release:install`** and Build Command: **`npm run release:check`**. Both are already configured in `frontend/vercel.json`; review dashboard overrides for mismatch.
4. Configure for each required environment (Production / Preview): `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_FASTAPI_URL`, and `FASTAPI_INTERNAL_URL` as HTTPS backend **origins**, e.g. `https://ai-quotation-api.onrender.com`, without `/api`. Keep `DATABASE_URL` and service keys **off Vercel frontend**. These names are retained, not introduced.
5. Ensure Render is reachable and has an allowed frontend CORS origin. Changing `NEXT_PUBLIC_` variables requires a new frontend build.
6. After committing the migrated lockfile, trigger a fresh Vercel deployment (clear build cache on the first deployment after a major dependency migration). Review the first failed release stage, if any.

## Validation performed

- `node --test frontend/tests/releasePolicy.test.mjs`: release regression suite, including Vercel config and rewrite checks.
- `node --experimental-strip-types --test frontend/tests/drawingLocator.test.mjs frontend/tests/apiRouting.test.mjs`: drawing/API regression tests.
- Static JavaScript syntax and archive preservation checks.
- Real `npm run release:install` against the old lock fails intentionally without mutating it.
- **Not verified**: npm registry dependency resolution, npm audit, production Next.js compilation, whole-application TypeScript check, and live deployment. These require the authentic migrated lockfile and a network-capable build runner.

Nothing in this audit modifies the earlier application flows, even when the existing deployment configuration differs from the recommended dashboard settings.
