# Next Phase: Real Drawing Extraction

Replace `backend/app/main.py -> mock_analyze_drawing()` with:

Drawing upload
-> PDF/Image/DXF/DWG/STEP router
-> OCR / Vision / CAD parser
-> normalized engineering JSON
-> confidence scoring
-> review page
-> costing engine
-> Excel/PDF quotation

Suggested backend modules:

backend/app/
- extraction/pdf.py
- extraction/vision.py
- extraction/dxf.py
- extraction/step.py
- costing/engine.py
- costing/rates.py
- quotation/excel.py
- quotation/pdf.py
- database/models.py
