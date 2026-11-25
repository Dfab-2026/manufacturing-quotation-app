# v92 — Deterministic frontend release dependency installation

## Scope

This update changes only the frontend release installer, local release preparation script, lockfile readiness checks, release regression tests, and this document. No application pages, drawing analysis, CAD viewer, quotation logic, backend, or other UI/flows are modified.

## Root cause

The supplied v91 `frontend/package.json` and `frontend/package-lock.json` both pin the *old* framework graph (Next.js 14.2.35, React 18.3.1). The project's existing security release policy instead requires Next.js >=15.5.29 (or a supported 16.x), compatible React 19 and newer transitive dependencies. Previously, `release:install` silently modified package.json and generated a new lockfile during deployment, so Vercel, CI and local builds could resolve different packages.

## New behavior

- `npm run release:install`: fail closed if the committed dependency pair is stale or inconsistent; otherwise run **`npm ci --include=dev --no-audit --no-fund`** against the committed lockfile. Never rewrite `package.json` or `package-lock.json`.
- `npm run build` / Vercel `release:check`: use the exact same lockfile verification and installed package checks before tests, audit, Next.js compilation and the final TypeScript check.
- `npm run release:prepare`: the *only explicit path* to migrating dependency versions and generating a real npm lockfile. Resolves the secure versions from npm, checks the new lock, runs the complete release gates, and restores both original files on any failure. This command must run on a machine with npm registry access.

## One-time action on your internet-connected Windows computer

At the extracted project root:

```powershell
cd frontend
node --version                  # Node.js 22.x (see .nvmrc)
npm --version
npm run release:prepare        # Generates and verifies a consistent secure lockfile
npm run build                  # Re-checks the exact committed dependency graph
npx tsc --noEmit               # Explicit final type-check
```

**Commit and deploy BOTH `frontend/package.json` and `frontend/package-lock.json` together**, after `release:prepare` succeeds. Do not commit only one file. `npm ci` must be used for repeatable clean installs; avoid running a lockfile-generating install in Vercel/CI.

If any command fails, inspect the actual failing test/build/audit/type error; do not ignore it or force deployment. If the prepare command restores the original manifest/lock, reset `node_modules` with `npm ci` after fixing registry access.

## Verification performed in this environment

- Release orchestration / lockfile regression tests: **13/13 passed**.
- Drawing locator and API routing regression tests: **20/20 passed**.
- Changed JavaScript modules: **syntax checks passed**.
- Actual v91 lockfile: **correctly rejected by the new installer without mutation**.
- npm registry: **unreachable (EAI_AGAIN)**. The real secure dependency graph could not be downloaded, so the full Next.js production build, application-wide TypeScript check, and npm audit remain **UNVERIFIED**. A generated or invented `package-lock.json` would not be safe or reproducible; the original real lockfile has intentionally been preserved for the explicit one-time preparation step.

Do not call this package production-build verified until `release:prepare`, `npm run build` and the final typecheck succeed in a registry-connected environment.
