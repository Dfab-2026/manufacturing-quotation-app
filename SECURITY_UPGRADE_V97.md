# V97 frontend security upgrade

The Vercel log from 2026-11-25 shows dependency install, lockfile policy, release tests, drawing-locator tests, and API-routing tests all pass. Deployment then fails at step 6 because npm audit reports one critical and two high vulnerabilities in the old Next.js 14.2.35 dependency tree.

V97 changes only the frontend dependency/release policy target to the current stable framework line:
- Next.js 16.4.6
- React 19.3.1
- React DOM 19.3.1
- @types/react 19.3.0
- @types/react-dom 19.3.0

No application route, page, quotation calculation, CAD extraction, PDF/Excel export, backend, draft, history, or navigation source was changed.

## Required one-time lockfile regeneration

This archive intentionally does not fabricate a package-lock.json. The lockfile must be resolved by npm on an internet-connected machine and then committed with package.json.

From `frontend`:

```powershell
npm run release:prepare
```

That command resolves the new lockfile, installs the exact graph, runs the security audit, Next.js production build, TypeScript check, and all regression tests. It restores the original dependency files if any step fails.

Only after it passes:

```powershell
git add package.json package-lock.json scripts/release-policy.mjs tests/releasePolicy.test.mjs
git commit -m "Upgrade frontend security baseline to Next 16.4.6"
git push origin main
```

Do not use `npm audit fix --force` because npm itself reports that this performs a breaking framework change without validating this application.
