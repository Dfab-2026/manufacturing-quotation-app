$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 backend\bootstrap.py
} else {
    & python backend\bootstrap.py
}
