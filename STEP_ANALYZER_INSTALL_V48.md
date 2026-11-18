# STEP Analyzer / 3D Preview setup (v48)

This project keeps the existing PDF workflow unchanged and adds a real STEP/STP/IGES analysis + 3D preview path.

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

## Frontend

Open a second PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

`npm install` installs `occt-import-js` and `three`. The frontend `postinstall` script automatically copies:

- `occt-import-js.js`
- `occt-import-js.wasm`

into `frontend/public/vendor/occt/` for same-origin STEP preview loading.

To repair only the STEP runtime if node_modules already exists:

```powershell
cd frontend
npm install occt-import-js@0.0.23 three@0.185.1
node scripts/copy-cad-runtime.mjs
npm run dev
```

Verify these files exist after installation:

```powershell
Get-ChildItem .\public\vendor\occt\
```

Expected files:

- `occt-import-js.js`
- `occt-import-js.wasm`

## STEP data extracted when available

- Overall X / Y / Z geometry
- Plate-like length / width / thickness mapping
- Solid volume
- Surface area
- Part / mesh / triangle counts
- Assembly/component/product names
- STEP schema
- Material designation/grade text when present
- Calculated weight when material density is recognized
- Cylindrical feature candidates and repeated quantity hints
- Thread-like designations
- Conical/chamfer candidates
- STEP/AP242 PMI/tolerance/datum entity/text hints
- Surface-finish text such as Ra/Rz when explicitly present
- Manufacturing classification/process route and costing rows

STEP files do not always contain drawing-only information such as title-block revision, notes, tolerances, surface finish, welding symbols, or material. Missing source data remains review-required instead of being invented.
