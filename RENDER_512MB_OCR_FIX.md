# Render 512 MB production fix

Production Render intentionally does not install or initialize RapidOCR/ONNX on 512 MB instances.

Render settings:
- Root Directory: `backend`
- Build: `python -m pip install --upgrade pip && pip install -r requirements-render.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- `LOCAL_OCR_ENABLED=false`

Local/full OCR:
```powershell
cd backend
python -m pip install -r requirements.txt
$env:LOCAL_OCR_ENABLED="true"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

When local OCR is disabled, FastAPI uses PDF/DXF extraction and the configured Gemini fallback for unresolved scanned/image content.
