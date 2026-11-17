from pathlib import Path
import re
import uuid

ROOT = Path(__file__).resolve().parents[1]


def test_drawing_ids_are_uuid_shaped_and_not_raw_hashes():
    source = (ROOT / 'app' / 'db.py').read_text(encoding='utf-8')
    assert 'uuid.uuid5' in source
    digest = '98ce406bca30a7ed636b71df7c838259072d61e76fd225e227ffc70a736543fb'
    stable = str(uuid.uuid5(uuid.NAMESPACE_URL, f'manufacturing-quotation:drawing:{digest}'))
    assert len(stable) == 36
    assert stable != digest


def test_analyze_cad_initializes_chamfers_in_payload():
    source = (ROOT / 'app' / 'main.py').read_text(encoding='utf-8')
    cad = source[source.index('def analyze_cad'):source.index('@app.post("/api/analyze")')]
    assert '"chamfers": []' in cad
    assert '"holes": []' in cad
    assert '"threads": []' in cad


def test_supported_analysis_formats_include_pdf_images_and_cad():
    source = (ROOT / 'app' / 'main.py').read_text(encoding='utf-8')
    for suffix in ('.pdf', '.png', '.jpg', '.webp', '.tiff', '.dxf', '.dwg', '.step', '.stp', '.iges', '.igs', '.stl', '.obj', '.x_t', '.x_b'):
        assert f'"{suffix}"' in source


def test_prediction_fallback_is_present():
    source = (ROOT / 'app' / 'main.py').read_text(encoding='utf-8')
    assert 'def _predicted_analysis_from_source' in source
    assert 'predicted_needs_review' in source
    assert 'No unsupported numeric geometry was fabricated.' in source
