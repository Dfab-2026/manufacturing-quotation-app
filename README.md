# AI Manufacturing Quotation Web App — V3

This version adds a structured **Rate Master** and **Criticality Score** system to the existing drawing → review → costing → quotation workflow.

## What is new in V3

### Rate Master
- Default opens on **Materials**.
- Common engineering materials are preloaded by **material name + grade**.
- Tabs: Materials, Processes, Labour, Commercial, Other, All.
- **+ Add Rate** button lets you add a new material/grade/process/labour/commercial cost.
- Edit price/rate, unit, critical score, active status and notes.
- Save or delete individual rate rows.
- Search by material, grade or process.

### Default material catalog
Includes starter entries for common grades such as:
- Stainless Steel: AISI 201, 202, 304, 304L, 316, 316L, 321, 430
- Mild / Carbon Steel: IS 2062 E250, E350, ASTM A36
- Aluminium: 5052-H32, 6061-T6, 6082-T6
- Galvanized Steel: DX51D+Z
- Copper: C110
- Brass: C260

These are only **starter configuration rates**, not live market prices. Replace prices with your approved company/supplier rates.

### All cost controls are editable
Rate Master includes:
- Materials
- Cutting / bending / welding / finishing / QC processes
- Labour rates
- Other costs such as packing and consumables
- Commercial rates: material wastage %, factory overhead %, profit/markup %

### Criticality Score
Every saved rate has a 0–100 criticality score.

Default meaning:
- 0–39 = Low
- 40–69 = Medium
- 70–100 = High

Higher criticality means the rate is more commercially sensitive / volatile / important to final quotation accuracy and should be checked more carefully.

This is **separate from drawing extraction confidence**.

In the Cost Sheet, each row shows:
- Rate
- Rate Source
- Critical Score
- Cost
- Extraction confidence

Rows using a saved rate show **Rate Master** as the source. If the user manually overrides a rate in the Cost Sheet, the row is marked **Manual Override** and criticality is raised to 100 until reviewed.

Use **Refresh Saved Rates** to reapply the latest Rate Master prices to the current cost sheet.

Excel export also includes Rate Source and Criticality Score.

The customer-facing quotation PDF intentionally does not expose internal criticality scores.

---

## Continuous dataset learning

The V2 dataset workflow remains active:
1. Every drawing extraction can be auto-captured as a dataset sample.
2. Engineer corrections are saved as reviewed training samples.
3. The exact same drawing hash can reuse the last reviewed correction.
4. Reviewed samples can be exported as JSONL for future validated model training.

This does **not** blindly retrain model weights after every single drawing. That avoids corrupting the model from one incorrect correction. Model retraining should happen in validated batches after the real AI extraction model is connected.

---

## Stack

Frontend:
- Next.js
- TypeScript
- React
- AG Grid

Backend:
- Python
- FastAPI
- JSON persistence for MVP
- openpyxl for Excel
- ReportLab for PDF

---

## Run backend

Open PowerShell in the `backend` folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Backend docs:

```text
http://127.0.0.1:8000/docs
```

## Run frontend

Open a second PowerShell terminal in the `frontend` folder:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## Important when replacing V2

If V2 is currently running:
1. Stop frontend/backend terminals with `Ctrl+C`.
2. Extract V3 to a new folder.
3. Run the V3 backend and frontend commands above.
4. Do not copy V2 `node_modules` or `.venv` folders into V3.

The V3 backend automatically migrates the older V2 rate dictionary to the new rate-table structure when required.


## V3.1 Important Fix — Different drawings no longer reuse the first sample

V3 used a hard-coded sample extractor for any unreviewed file. That made different PDFs appear to return the first 304SS drawing.

V3.1 changes the behavior:

- Every upload is identified by SHA-256 file hash.
- Exact reviewed memory is reused **only** for the exact same file hash.
- A new PDF is parsed independently with `pypdf`.
- If data cannot be read reliably, fields stay blank / "Not detected" instead of copying another drawing.
- Selecting a new file clears the previous drawing, rows, totals and revision state immediately.
- Every extraction still becomes a dataset sample.
- Reviewed corrections still become training-quality dataset records.

### Current limitation

This version is a safe text-based PDF extractor, not the final AI engineering-drawing reader.
Scanned/image PDFs, symbols, geometry, DXF/DWG and complex engineering drawings still need the planned Vision/OCR/CAD extraction module.
The important fix is that the app will **never pretend another drawing's data belongs to the new file**.
