"""A low-memory production plan must return real PDF parsing, not a fetch error."""

import io

import fitz
from fastapi.testclient import TestClient

from app import main


def test_vector_pdf_analysis_stays_available_without_onnx_ocr(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'false')
    with fitz.open() as document:
        page = document.new_page(width=600, height=850)
        page.insert_text((65, 90), 'DRAWING NO: TUBE-316-01', fontsize=12)
        page.insert_text((65, 125), 'MATERIAL: SS316', fontsize=12)
        page.insert_text((65, 155), 'WALL THICKNESS: 2.0 mm', fontsize=12)
        page.insert_text((65, 185), 'LENGTH 120 mm', fontsize=12)
        content = document.tobytes()
    response = TestClient(main.app).post(
        '/api/analyze?force_ai=false',
        files={'file': ('manufacturing_tube.pdf', content, 'application/pdf')},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['file_hash']
    assert payload['drawing']['drawing_no']
    assert 'fallback service: Failed to fetch' not in str(payload)
    assert payload['learning_source'].startswith('fastapi_local')
