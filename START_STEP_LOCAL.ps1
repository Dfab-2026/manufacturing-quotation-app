$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
  Write-Host 'Backend virtual environment not found. Run:' -ForegroundColor Yellow
  Write-Host '  cd backend; python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt'
  exit 1
}

& $python -c "from OCP.STEPControl import STEPControl_Reader; print('Python OpenCascade: OK')"
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Python OpenCascade is missing. Run backend\ .venv activation and pip install -r requirements.txt.' -ForegroundColor Red
  exit 1
}

Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$backend'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$frontend'; npm run dev"
Write-Host 'Started backend on http://127.0.0.1:8000 and frontend on http://localhost:3000' -ForegroundColor Green
