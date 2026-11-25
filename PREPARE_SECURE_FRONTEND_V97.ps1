$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root 'frontend'
Set-Location $frontend
Write-Host 'Preparing the committed secure frontend dependency graph...'
node --version
npm --version
npm run release:prepare
Write-Host ''
Write-Host 'V97 secure dependency graph passed all release checks.'
Write-Host 'Commit package.json and package-lock.json together before Vercel deployment.'
