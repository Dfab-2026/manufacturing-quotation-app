$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $Root "frontend")
Write-Host "Starting DFAB AI Quotation frontend from:" (Get-Location)
Write-Host "Open http://localhost:3000/ (old /upload bookmarks redirect to the same app)."
if (-not (Test-Path "node_modules")) { npm install }
npm run dev
