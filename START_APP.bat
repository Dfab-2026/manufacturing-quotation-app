@echo off
setlocal
cd /d "%~dp0"
start "DFAB FastAPI" cmd /k call "%~dp0START_BACKEND.bat"
if not exist "frontend\node_modules" (
  echo Installing frontend dependencies once...
  pushd "frontend"
  call npm install
  if errorlevel 1 (
    echo Frontend dependency installation failed.
    popd
    pause
    exit /b 1
  )
  popd
)
start "DFAB Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"
echo Backend and frontend start commands launched.
