# V89 — Vercel Node.js runtime hotfix

Based on V88. The reported deployment stopped inside `release:install` before dependency installation. The previous condition combined two separate failures: unsupported Node.js and missing `npm_execpath`. The build log did not print the actual Node version. Neither the npm cache-dir warning nor drawing processing caused this failure.

Changes: pin `engines.node` to `22.x` in the root and active frontend package manifests and matching lockfile root metadata; add `.nvmrc`; print the detected Node version and distinguish npm lifecycle misconfiguration from a version mismatch. Existing dependencies, release security policy, frontend screens, backend, data flows and deployment commands remain unchanged.

Vercel: Project Settings → Node.js Version → 22.x (in Build and Deployment or General, depending on dashboard layout). Root Directory `frontend`; Install Command `npm run release:install`; Build Command `npm run release:check`. Push V89 and redeploy without using the previous build cache. Vercel uses the package.json engines.node field to override the dashboard selection. See https://vercel.com/docs/functions/runtimes/node-js/node-js-versions . Keep all Render and Supabase settings unchanged.

Local: use Node.js 22.x, run `npm run release:prepare` from frontend, and commit the genuinely migrated package.json and package-lock.json after successful validation. Do not bypass the security baseline, npm audit, or type checking.

Verification: Node v22.16.0 / npm 10.9.2; 83 backend tests, 14 locator tests, 6 routing tests, 9 release tests (29 frontend tests total). Actual npm lifecycle invocation passed the Node guard and reached dependency resolution. Network probe failed with EAI_AGAIN for registry.npmjs.org; offline attempt failed ENOTCACHED for @types/react-dom. The original manifests were restored as designed. Real Next.js dependency upgrade, full production build, security audit, Vercel deployment and live workflows are unverified and still required. The checked-in frontend dependency lock remains the V88 migration seed, not a resolved production dependency graph.
