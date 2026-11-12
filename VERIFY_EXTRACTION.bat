@echo off
setlocal
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo Backend virtual environment not found. Run START_BACKEND.bat once first.
  pause
  exit /b 1
)
.venv\Scripts\python.exe check_extraction.py
.venv\Scripts\python.exe -m pip check
if errorlevel 1 pause
