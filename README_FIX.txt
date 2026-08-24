v0.6.4 PyMuPDF import fix

Problem:
[ANALYZE ERROR] NameError name 'fitz' is not defined

Cause:
The code still calls fitz.open(), fitz.Matrix(), etc.
With the newer PyMuPDF API the import must preserve the 'fitz' alias.

Fix applied in BOTH files:
- backend/app/main.py
- backend/app/extraction/pipeline.py

Correct import:
import pymupdf as fitz

After replacing the files:

python -m pip install -U pymupdf
python -m uvicorn app.main:app --reload --port 8000

Then test one drawing locally.
