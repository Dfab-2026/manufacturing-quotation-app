import shutil
import pytest
from fastapi.testclient import TestClient
from app import main
from app.extraction import ocr_runtime


def test_disabled_reader_reports_configuration(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'false')
    config = ocr_runtime.ocr_configuration()
    assert not config['available'] and config['reason'] == 'disabled_by_environment'
    response = TestClient(main.app).get('/api/ocr/health')
    assert response.status_code == 200
    assert response.json()['verified'] is False
    assert response.json()['reason'] == 'disabled_by_environment'
    assert 'true' in main._ocr_unavailable_warning()


def test_missing_ocr_reports_dependencies(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'true')
    monkeypatch.setattr(ocr_runtime.shutil, 'which', lambda _: None)
    monkeypatch.setattr(ocr_runtime.importlib.util, 'find_spec', lambda _: None)
    config = ocr_runtime.ocr_configuration()
    assert config['reason'] == 'missing_ocr_dependencies'
    assert not ocr_runtime.smoke_test()['verified']
    assert 'requirements-render.txt' in main._ocr_unavailable_warning()


@pytest.mark.skipif(not shutil.which('tesseract'), reason='Tesseract unavailable')
def test_deployment_smoke_test_reads_actual_callouts(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'true')
    response = TestClient(main.app).get('/api/ocr/health')
    data = response.json()
    assert data['verified'] is True, data
    assert data['backend'] == 'tesseract'
    assert data['extraction_pipeline_version'] == main.EXTRACTION_PIPELINE_VERSION


def test_standard_health_reports_active_configuration(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'false')
    data = TestClient(main.app).get('/api/health').json()
    assert data['local_ocr'] == 'disabled_or_unavailable'
    assert data['ocr_configuration']['reason'] == 'disabled_by_environment'
    assert data['extraction_pipeline_version'] == main.EXTRACTION_PIPELINE_VERSION
