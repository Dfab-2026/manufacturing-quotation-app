$ErrorActionPreference = "Stop"

Write-Host "Installing STEP analyzer frontend dependencies..." -ForegroundColor Cyan
Set-Location "$PSScriptRoot\frontend"
npm install
node scripts/copy-cad-runtime.mjs

Write-Host "STEP runtime files:" -ForegroundColor Cyan
Get-ChildItem "$PSScriptRoot\frontend\public\vendor\occt"

Write-Host "Frontend dependencies installed. Run: npm run dev" -ForegroundColor Green
