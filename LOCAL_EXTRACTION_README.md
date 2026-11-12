# Fast local-first extraction (this uploaded app only)

- Default: `EXTRACTION_MODE=local`. No Gemini requests are made while uploading PDFs/images.
- FastAPI serves `/api/analyze`; PyMuPDF reads born-digital PDF text; optional local Tesseract OCR handles scanned pages and pictures.
- Install Python requirements using `pip install -r backend/requirements.txt` (from root), and for scanned pages install the **Tesseract executable** separately on Windows. Make sure `tesseract --version` works in PowerShell, or restart your terminal after installing.
- For images with no working OCR, the UI still opens an editable review with clear warnings, **not fabricated drawing dimensions**.
- Optional `EXTRACTION_MODE=hybrid` and `GEMINI_API_KEY` only call Gemini when local text is not usable. Set `gemini` only if intentionally opting into AI-first behavior.
- STEP/other supported CAD 3D conversion and DXF geometry follow the existing independent paths; binary DWG is not magically parsed.
- The app's existing PostgreSQL storage, Rate Master, quotation, and pricing calculations were not changed.
- The PostgreSQL database **must be reachable**: use the Supabase Session Pooler URI where appropriate. Local extraction does not bypass existing DB requirements.

## Run
Terminal 1:
```
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Terminal 2:
```
cd frontend
npm install
npm run dev
```

## Important limits
No offline parser can recover engineering geometry and all tolerances from every drawing/image reliably. Scanned diagrams require OCR, and component geometry/assemblies must still be confirmed by the estimator. FastAPI itself is not an AI model. An incorrect/missing material or weight remains flagged for review.
