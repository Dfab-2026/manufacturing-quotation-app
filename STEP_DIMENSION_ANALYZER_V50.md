# STEP Dimension Analyzer V50

This update preserves the existing PDF, quotation, history, Draft/Ongoing, costing and UI flows.

## What changed

STEP/STP analysis now combines two dimension sources:

1. **OpenCascade model geometry** for overall X/Y/Z envelope, surface area and solid volume.
2. **Exact analytic STEP entities** for source-backed feature dimensions where present:
   - `CYLINDRICAL_SURFACE` -> exact diameter candidates
   - `CIRCLE` -> exact circular-edge diameter candidates
   - `TOROIDAL_SURFACE` -> exact major/minor radii (useful for elbows/bends)
   - `CONICAL_SURFACE` -> radius + semi-angle metadata
   - AP242/PMI labels, datum/tolerance/surface-finish information when exported in the STEP file

Exact analytic values are added to the same `dimensions` array used by PDF extraction. Ambiguous geometry is flagged for review rather than being incorrectly labeled as a hole, OD or bore.

## Required software

- Python 3.12 recommended
- Node.js 20+ or 22+
- npm

## Frontend packages

Already present in `frontend/package.json`:

- `occt-import-js` - OpenCascade STEP/IGES parser
- `three` - 3D rendering
- Next.js / React existing dependencies

No additional heavy Python CAD kernel is required for this update.

## Install

From the project root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\INSTALL_STEP_DIMENSION_ANALYZER.ps1
```

Or manually:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt

cd ..\frontend
npm install
node scripts\copy-cad-runtime.mjs
npm run dev
```

In another PowerShell terminal:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

Verify these files exist after `npm install`:

```powershell
Get-ChildItem .\frontend\public\vendor\occt\
```

Expected:

- `occt-import-js.js`
- `occt-import-js.wasm`

## Important behavior

STEP geometry can provide exact geometric sizes, but it does not automatically contain drawing intent. For example, a cylindrical STEP surface may be an OD, bore, boss or hole. The app therefore shows exact source-backed diameter/radius values and marks ambiguous classifications as review-required.

PMI/GD&T/tolerances are only extracted when the originating CAD system exported them into the STEP file (commonly AP242). The system does not fabricate missing tolerances.
