# V88 — deployment bootstrap and targeted UI cleanup

Base: the supplied `manufacturing-quotation-app-v87-release-stability.zip`. This release changes deployment tooling and CSS only. No drawing extraction, thickness, predicted measurement, Locate coordinates, BOM, material costing, Rate Master, history, draft, ongoing quotation, API contract, database schema, or saved-data workflow changes.

## Confirmed V87 deployment blocker

V87's `frontend/vercel.json` used `npm ci` followed by `npm run release:check`. Its checked-in lockfile resolves Next.js 14.2.35, whereas the release check intentionally requires a patched supported Next.js branch. A fresh checkout therefore cannot pass the release gate unless somebody first migrates the dependency files. V88 performs migration before the gate in both local and hosted builds. The actual user deployment log was not supplied, so additional cloud-specific failures cannot be ruled out.

- `npm run release:install`: on a stale lock, resolves a genuine npm lock for Next.js `^15.5.29`, matching React/React DOM `19.3.1`, and React 19 types in one operation. It then runs `npm ci --include=dev`. Existing unrelated dependency specifications are preserved. On an already supported, matching lock it uses `npm ci` directly. Installed versions and copied OCCT CAD assets must match before it succeeds.
- `npm run release:check` and `npm run build`: ensure installation, verify the installed/locked versions, run frontend release/locator/routing tests, run the real Next production build and TypeScript check, and run `npm audit --audit-level=high`. The audit and security gate are NOT bypassed.
- `npm run release:prepare`: runs the installer and all release checks. If dependency migration or any check fails, restore the original manifests and return a nonzero exit code. If the install was interrupted or rolled back, use `npm ci` to restore its old local development runtime. Never deploy a failed release.
- Vercel and GitHub CI use the same installer. This also repairs a build where a dashboard override installed the old lock with `npm ci` before invoking `npm run build`.
- Production Python uses `opencv-python-headless` (RapidOCR 3.10+ also depends on headless OpenCV), not desktop OpenCV, to avoid shared `cv2` package collisions and GUI/libGL import failures on Linux. The Render build smoke test checks OpenCascade in addition to the existing real OCR recognition test.
- CSS-only UI changes: consistent wrapping of existing action rows, compact cost-card title layout, readable extraction status labels, mobile drawing table sizing and locator controls. Original theme, button handlers, field lists, page layouts and 10px source indication retained.

Security baseline references: https://www.netlify.com/changelog/2026-11-03-nextjs-security-vulnerabilities/ ; https://nextjs.org/support-policy ; https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3 ; https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/install/ ; https://vercel.com/docs/builds/configure-a-build

## Local verification before pushing (Windows PowerShell)

Use Node.js 22 or 24 LTS and npm. From the `frontend` folder:

```powershell
npm run release:prepare
```

No preceding `npm ci` is necessary: the preparation command handles it. After success, commit both the generated `frontend/package-lock.json` and updated `frontend/package.json` with the other source changes. Run `npm run dev` for local workflow testing. Do not use `npm audit fix --force` or bypass peer-dependency checks.

The ZIP intentionally includes the original consistent dependency manifest/lock as migration input; the actual upgraded lock has NOT been generated in this environment because registry access is unavailable. The installer creates it using npm on a machine with access. Commit the resulting lock for reproducible future releases. Next 15 is a transitional maintenance branch; a separately verified Next 16 migration is advisable before its maintenance period ends.

## Vercel settings

| Setting | Value |
|---|---|
| Framework | Next.js |
| Root Directory | `frontend` |
| Node.js Version | `22.x` |
| Install Command | `npm run release:install` |
| Build Command | `npm run release:check` |

The repository `frontend/vercel.json` sets install/build commands. Review any Vercel Dashboard overrides, and redeploy without the old build cache if needed. Keep the three existing FastAPI URL variables pointing at your backend. Never put `DATABASE_URL`, API keys or credentials in frontend environment variables.

## Render settings

- Root: `backend`
- Build: `python -m pip install --upgrade pip && pip install -r requirements-render.txt && python verify_runtime.py --require-ocr`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- `PYTHON_VERSION=3.12.10`, `LOCAL_OCR_ENABLED=true`; preserve DATABASE_URL and other existing variables.
- Clear the old build cache and deploy to avoid the cached desktop OpenCV distribution (headless and GUI wheels share files). Verify `/api/health` and `/api/ocr/health` on the running backend. The local OCR check used Tesseract, not Render's actual RapidOCR/ONNX model. A model download, runtime memory limit or database failure remains a possible deployment-specific issue.

## Verification in this environment

- Backend regression suite: **83 passed** (temporary SQLite path outside the packaged project).
- Frontend: **27 passed** (14 locator, 6 routing, 7 release policy/orchestration). Release orchestration uses a simulated npm executor to test real installer decisions, migration, matching runtime, repeat builds, error rollback and configuration; it is not a test of registry package contents.
- Real OCR smoke test: passed with local Tesseract; installed OCP imported successfully.
- Chromium static layout fixture with actual production CSS and representative existing markup: 360, 768, 1280, 1600px, no page/action-container horizontal overflow; marker remains 10px. Not a full React application test.
- Node script syntax, original source preservation and ZIP integrity checked.
- Actual npm installation attempted with the offline cache; npm reported `ENOTCACHED` for the React type package. Registry DNS is unavailable in this execution environment. The installer correctly restored original manifests and returned a failure. Full production build, full TypeScript checks, Next lint and live application/browser integration are **not verified** after the upgrade. Next build and npm audit must pass on the real deployment runner. Live Supabase, Render's actual ONNX runtime and Vercel deployment remain unverified. No production certification or claim of zero vulnerabilities is made.

## Public deployment safety

Existing unauthenticated shared-data architecture remains unchanged as requested. A publicly reachable backend serving confidential drawings/quotations needs proper authentication and authorization, organization isolation and storage protection. Do not treat CORS as access control. Keep deployment access restricted until these gates and live regression tests are satisfied. The existing `.gitignore` excludes private historical reference files; review all existing tracked files before pushing to a public repository.
