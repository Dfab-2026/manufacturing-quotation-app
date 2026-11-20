import fitz
from app.drawing_evidence import attach_pdf_evidence

def test_drawing_image_without_callouts():
    doc = fitz.open(); doc.new_page(); content = doc.tobytes(); doc.close()
    data = {}
    attach_pdf_evidence(data, content)
    assert data['evidence_preview'].startswith('data:image/jpeg;base64,')
    assert data['drawing_locations'] == []
