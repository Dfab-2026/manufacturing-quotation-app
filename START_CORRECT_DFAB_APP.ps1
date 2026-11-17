Write-Host "Starting DFAB Manufacturing Quotation frontend..." -ForegroundColor Cyan
Set-Location "$PSScriptRoot\frontend"
if (-not (Test-Path "node_modules")) { npm install }
npm run dev
