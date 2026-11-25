"""Regressions for identity/material recovery without inventing dimensions."""

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

from app.main import _local_fastapi_engineering_extract, app
from app.extraction.product_regions import source_text


def make_pdf(lines):
    with fitz.open() as document:
        page = document.new_page(width=660, height=480)
        for idx, line in enumerate(lines):
            page.insert_text((40, 55 + idx * 26), line, fontsize=10)
        return document.tobytes()


def test_filename_material_pid_revision_are_reviewable_hints():
    pdf = make_pdf(['OVERALL LENGTH 120 mm', 'WALL THICKNESS 2 mm'])
    filename = '[PID#16494] 316SS Tube, Primary Return - R2.00-2025-06-05.pdf'
    raw, drawing, _rows, warnings, _ = _local_fastapi_engineering_extract(pdf, filename, False)
    assert raw['material']['grade'] == 'AISI 316'
    assert drawing.drawing_no == 'PID#16494'
    assert drawing.revision == 'R2.00'
    assert raw['confidence']['material'] < 80
    assert any('filename' in warning.lower() and 'material' in warning.lower() for warning in warnings)
    assert raw['width_mm'] is None  # Do not invent a width from the filename.


def test_explicit_material_and_identity_override_conflicting_filename():
    pdf = make_pdf([
        'DRAWING NO: TRUE-12', 'REVISION: R3', 'MATERIAL: SS 304',
        'OVERALL LENGTH 120 mm', 'WALL THICKNESS 2 mm',
    ])
    filename = '[PID#16494] 316SS Tube - R2.00-2025-06-05.pdf'
    raw, drawing, _rows, warnings, _ = _local_fastapi_engineering_extract(pdf, filename, False)
    assert raw['material']['grade'] == 'AISI 304'
    assert drawing.drawing_no == 'TRUE-12'
    assert drawing.revision == 'R3'
    assert not any('material inferred from filename' in warning.lower() for warning in warnings)


def test_unlabelled_316ss_in_vector_text_is_material_not_dimension():
    pdf = make_pdf(['316SS', 'LENGTH: 125 mm', 'THK: 3 mm'])
    raw, drawing, _rows, _warnings, _ = _local_fastapi_engineering_extract(pdf, 'drawing.pdf', False)
    assert raw['material']['grade'] == 'AISI 316'
    assert drawing.thickness_mm == pytest.approx(3)
    assert not any(d.get('value_mm') == 316 for d in raw['dimensions'])


def test_api_uses_new_extraction_version_and_preserves_real_fields(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'false')
    pdf = make_pdf(['OVERALL LENGTH 130 mm', 'WIDTH 40 mm', 'THK 2 mm', 'MATERIAL SS316', 'WEIGHT 0.15 kg'])
    response = TestClient(app).post('/api/analyze?force_ai=false', files={
        'file': ('sheet.pdf', pdf, 'application/pdf')
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['drawing']['thickness_mm'] == pytest.approx(2)
    assert '316' in result['drawing']['material']
    assert result['ai_raw']['extraction_meta']['pipeline_version'].startswith('fastapi-product-regions-v')


def test_split_title_block_cells_yield_material_and_stated_weight():
    with fitz.open() as document:
        page = document.new_page(width=600, height=400)
        page.insert_text((80, 70), 'LENGTH 100 mm', fontsize=11)
        page.insert_text((80, 95), 'THK 2.0 mm', fontsize=11)
        for y, label, value in ((320, 'MATERIAL', 'SS 316'),
                                (337, 'WEIGHT', '0.142 kg'),
                                (354, 'DRAWING NO', 'XYZ-191')):
            page.insert_text((310, y), label, fontsize=8)
            page.insert_text((450, y), value, fontsize=8)
        page.insert_text((310, 370), 'REVISION R2', fontsize=8)
        pdf = document.tobytes()
    product, metadata, full, _ = source_text(pdf, 'split.pdf')
    assert 'MATERIAL: SS 316' in metadata
    assert 'WEIGHT: 0.142 kg' in metadata
    assert '0.142' not in product
    raw, drawing, _rows, warnings, _ = _local_fastapi_engineering_extract(pdf, 'split.pdf', False)
    assert raw['material']['grade'] == 'AISI 316'
    assert drawing.weight_kg == pytest.approx(.142)
    assert raw['weight_source'] == 'drawing_stated'
    assert not any(dim.get('value_mm') == .142 for dim in raw['dimensions'])


def test_repeated_pdf_metadata_access_reuses_parsed_regions(monkeypatch):
    from app.extraction import product_regions

    pdf = make_pdf(['LENGTH 121.45 mm', 'THK 2.75 mm', 'MATERIAL: SS316L'])
    original = product_regions.native_regions
    calls = []

    def counted(content):
        calls.append(1)
        return original(content)

    monkeypatch.setattr(product_regions, 'native_regions', counted)
    first = product_regions.source_text(pdf, 'cached.pdf')
    second = product_regions.source_text(pdf, 'cached.pdf')
    assert first == second
    assert len(calls) == 1


def test_source_text_cache_key_includes_ocr_regions():
    pdf = make_pdf(['LENGTH 100 mm'])
    native = source_text(pdf, 'ocr-cache.pdf')
    regions = [{'page': 0, 'text': 'WEIGHT 0.24 kg', 'box': [.1, .15, .3, .20], 'score': .96}]
    supplemented = source_text(pdf, 'ocr-cache.pdf', regions)
    assert native != supplemented
    assert any('0.24' in value for value in supplemented)


def test_filename_only_grade_does_not_mark_mandatory_material_verified():
    pdf = make_pdf(['OVERALL LENGTH 100 mm', 'WIDTH 50 mm', 'THK 2 mm'])
    raw, drawing, _rows, warnings, _ = _local_fastapi_engineering_extract(pdf, 'SS316-plate.pdf', False)
    assert raw['material']['grade'] == 'AISI 316'
    assert raw['material_source'] == 'filename_review_required'
    assert raw['mandatory_fields']['material'] is False
    assert raw['mandatory_complete'] is False
    assert drawing.weight_kg == 0  # Density cannot be assumed from an unverified filename.
