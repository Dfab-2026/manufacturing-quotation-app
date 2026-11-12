$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',"$PSScriptRoot\START_BACKEND.ps1"
if (-not (Test-Path "$PSScriptRoot\frontend\node_modules")) {
    Push-Location "$PSScriptRoot\frontend"
    npm install
    Pop-Location
}
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$PSScriptRoot\frontend'; npm run dev"
