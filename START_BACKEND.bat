@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3.12 backend\bootstrap.py
) else (
  python backend\bootstrap.py
)
if errorlevel 1 pause
