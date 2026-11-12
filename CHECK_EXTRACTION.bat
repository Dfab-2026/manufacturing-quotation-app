@echo off
setlocal
cd /d "%~dp0"
if exist backend\.venv\Scripts\python.exe (
  backend\.venv\Scripts\python.exe backend\check_extraction.py
) else (
  echo Backend environment is not installed yet. Run START_BACKEND.bat first.
)
pause
