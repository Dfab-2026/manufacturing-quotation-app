$ErrorActionPreference = "Stop"

Write-Host "=== DFAB STEP B-Rep Dimension Analyzer Setup ===" -ForegroundColor Cyan

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

if (-not (Test-Path $Backend)) { throw "backend folder not found: $Backend" }
if (-not (Test-Path $Frontend)) { throw "frontend folder not found: $Frontend" }

Write-Host "`n[1/6] Checking Python" -ForegroundColor Yellow
$pyVersion = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
Write-Host "Python $pyVersion"
if ($pyVersion -notin @("3.11", "3.12", "3.13", "3.14")) {
    throw "Python 3.11-3.14 is required for cadquery-ocp-novtk. Python 3.12 is recommended for this project."
}

Write-Host "`n[2/6] Backend virtual environment + FastAPI/Python OpenCascade" -ForegroundColor Yellow
Set-Location $Backend
if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

Write-Host "`n[3/6] Verifying Python OpenCascade (OCP)" -ForegroundColor Yellow
& .\.venv\Scripts\python.exe -c "from OCP.STEPControl import STEPControl_Reader; from OCP.BRepGProp import BRepGProp; from OCP.BRepBndLib import BRepBndLib; print('Python OpenCascade/OCP: OK')"

Write-Host "`n[4/6] Frontend dependencies (OpenCascade WASM + Three.js)" -ForegroundColor Yellow
Set-Location $Frontend
npm install
node scripts/copy-cad-runtime.mjs

$OcctJs = Join-Path $Frontend "public\vendor\occt\occt-import-js.js"
$OcctWasm = Join-Path $Frontend "public\vendor\occt\occt-import-js.wasm"
if (-not (Test-Path $OcctJs)) { throw "Missing $OcctJs" }
if (-not (Test-Path $OcctWasm)) { throw "Missing $OcctWasm" }

Write-Host "`n[5/6] Checking port 3000" -ForegroundColor Yellow
$port3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($port3000) {
    $pids = $port3000 | Select-Object -ExpandProperty OwningProcess -Unique
    Write-Host "Port 3000 is already in use by PID(s): $($pids -join ', ')" -ForegroundColor Yellow
    Write-Host "Close that old frontend before running npm run dev. This project is pinned to port 3000 and will not silently move to 3001." -ForegroundColor Yellow
} else {
    Write-Host "Port 3000: available" -ForegroundColor Green
}

Write-Host "`n[6/6] Setup complete" -ForegroundColor Green
Write-Host "OpenCascade JS/WASM: OK" -ForegroundColor Green
Write-Host "Python OpenCascade/OCP: OK" -ForegroundColor Green
Write-Host ""
Write-Host "BACKEND terminal:" -ForegroundColor Cyan
Write-Host "  cd `"$Backend`""
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host "  uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
Write-Host ""
Write-Host "FRONTEND terminal:" -ForegroundColor Cyan
Write-Host "  cd `"$Frontend`""
Write-Host "  npm run dev"
Write-Host ""
Write-Host "Frontend URL: http://localhost:3000" -ForegroundColor Green
