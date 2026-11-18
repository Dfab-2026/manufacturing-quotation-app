# V49 STEP Viewer + Analyzer Fix

This patch keeps the existing quotation/UI/history/PDF flows unchanged and repairs the STEP/STP preview and data prediction path.

## Required frontend runtime

From `frontend`:

```powershell
npm install
```

The existing `postinstall` script copies the OpenCascade browser runtime from `occt-import-js` into:

- `public/vendor/occt/occt-import-js.js`
- `public/vendor/occt/occt-import-js.wasm`

If those files are not present, run:

```powershell
npm install occt-import-js@0.0.23 three@0.185.1
node scripts/copy-cad-runtime.mjs
```

Then confirm:

```powershell
Get-ChildItem .\public\vendor\occt\
```

Start the frontend:

```powershell
npm run dev
```

## Backend

```powershell
cd backend
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## What changed

- STEP/STP/IGES preview tries OpenCascade in a Web Worker first.
- If the worker is blocked by Blob/CSP/runtime-path rules, it automatically falls back to a same-origin main-thread OpenCascade parser.
- STEP viewer timeout is increased for real manufacturing CAD models.
- Step 2 preview uses the current active CAD source directly.
- Viewer canvas is forced to occupy the Drawing Snapshot area and shows loading/error state instead of a silent blank rectangle.
- `316SS`, `316L SS`, `304SS`, etc. in STEP names are recognized as stainless material hints.
- If a recognized material and parsed STEP volume exist, weight is calculated from solid volume x material density.
- For rotational/hollow STEP models, wall thickness can be predicted from plausible inner/outer cylindrical diameter pairs and is explicitly marked for engineering review.

## Verification performed

- Backend complete suite: 12 passed.
- Changed frontend TS/TSX files: TypeScript syntax transpilation passed.
- Full `npm ci` could not complete in the sandbox because package download timed out, so a full Next.js build is not claimed here.
