@echo off
set ROOT=%~dp0
start "Quotation Backend" cmd /k "cd /d %ROOT%backend && if not exist .venv python -m venv .venv && call .venv\Scripts\activate.bat && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000"
start "Quotation Frontend" cmd /k "cd /d %ROOT%frontend && npm install && npm run dev"
echo Starting backend and frontend in separate windows...
