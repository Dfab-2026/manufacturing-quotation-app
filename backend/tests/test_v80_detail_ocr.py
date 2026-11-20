import shutil
from io import BytesIO
import fitz
import pytest
from app.extraction.detail_ocr import read_detail,detail_text
from app.drawing_evidence import attach_pdf_evidence
from app.main import _local_fastapi_engineering_extract


def raster_fixture():
    source=fitz.open()
    for lines in (["DRAWING NO: DETAIL-001", "MATERIAL: SS 304", "LENGTH: 120 mm"], ["WIDTH: 80 mm", "THICKNESS: 2.5 mm", "WEIGHT: 0.19 kg", "R2.1"]):
        page=source.new_page(width=360,height=260)
        for n,line in enumerate(lines):page.insert_text((180,50+n*30),line,fontsize=5.5)
    scanned=fitz.open()
    for page in source:
        dst=scanned.new_page(width=360,height=260)
        dst.insert_image(dst.rect,pixmap=page.get_pixmap(matrix=fitz.Matrix(5,5),alpha=False))
    result=scanned.tobytes();scanned.close();source.close();return result

@pytest.mark.skipif(not shutil.which('tesseract'),reason='Tesseract executable unavailable')
def test_tiny_raster_callouts_on_multiple_pages(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED','true')
    content=raster_fixture()
    regions,warnings=read_detail(content,'tiny.pdf')
    text=detail_text(regions)
    assert not warnings, warnings
    assert '2.5' in text, text
    assert {r['page'] for r in regions}=={0,1}
    raw,drawing,rows,_,_=_local_fastapi_engineering_extract(content,'tiny.pdf',True)
    assert drawing.thickness_mm==pytest.approx(2.5)
    assert raw['weight_kg']==pytest.approx(.19)
    assert raw['width_mm']==pytest.approx(80)
    attach_pdf_evidence(raw,content)
    hits=[r for r in raw['drawing_locations'] if r['label'].lower()=='thickness' and r['page']==1]
    assert hits,raw['drawing_locations']
    assert all(.45<r['x']<1 and 0<r['y']<.6 for r in hits)


def test_tile_limit_reports_partial_coverage(monkeypatch):
    from app.extraction import detail_ocr
    monkeypatch.setenv('DETAIL_OCR_MAX_TILES','1')
    monkeypatch.setattr(detail_ocr,'_recognize',lambda image,engine,timeout: [('THK 3',(5,5,70,25),.99)])
    content=raster_fixture()+b'\n%budget-test'
    regions,warnings=read_detail(content,'limited.pdf')
    assert regions and any('complete pages' in w for w in warnings)

@pytest.mark.skipif(not shutil.which('tesseract'),reason='Tesseract executable unavailable')
def test_analyze_api_returns_detail_extraction(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setenv('LOCAL_OCR_ENABLED','true')
    response=TestClient(app).post('/api/analyze?force_ai=true',files={'file':('tiny.pdf',raster_fixture(),'application/pdf')})
    assert response.status_code==200,response.text[:500]
    result=response.json()
    assert result['drawing']['thickness_mm']==pytest.approx(2.5)
    assert result['drawing']['weight_kg']==pytest.approx(.19)
    assert any(r['page']==1 and 'thickness' in r['label'].lower() for r in result['ai_raw']['drawing_locations'])


def test_height_named_dimension():
    pdf=fitz.open();page=pdf.new_page()
    for n,line in enumerate(['LENGTH 90 mm','WIDTH 60 mm','HEIGHT 30 mm','THK 2 mm']):page.insert_text((40,40+20*n),line)
    content=pdf.tobytes();pdf.close()
    raw,*_=_local_fastapi_engineering_extract(content,'part.pdf',False)
    assert raw['height_mm']==30


def test_portable_ocr_result_shape(monkeypatch):
    from app.extraction import detail_ocr
    from types import SimpleNamespace
    from PIL import Image
    monkeypatch.setattr(detail_ocr.shutil,'which',lambda _:None)
    engine=lambda image: SimpleNamespace(txts=['THK 4'],boxes=[[[10,10],[90,10],[90,30],[10,30]]],scores=[.98])
    assert list(detail_ocr._recognize(Image.new('RGB',(100,100)),engine,5))==[('THK 4',(10.,10.,90.,30.),.98)]
