"""Product views are engineering evidence; title-block and revision cells are not."""
from io import BytesIO
import shutil
import fitz
import pytest
from app.main import _local_fastapi_engineering_extract, analyze_dxf_geometry
from app.drawing_evidence import attach_pdf_evidence
from app.extraction.product_regions import source_text, partition, normalize_length_units


def fixture(raster=False):
    doc=fitz.open();p=doc.new_page(width=600,height=400)
    p.draw_rect(fitz.Rect(30,30,570,375));p.draw_rect(fitz.Rect(80,70,250,180))
    p.insert_text((80,55),'LENGTH: 120 mm',fontsize=10)
    p.insert_text((80,204),'WIDTH: 60 mm',fontsize=10)
    p.insert_text((80,228),'THK: 2.5 mm',fontsize=10)
    p.insert_text((80,248),'R2.1',fontsize=10)
    p.insert_text((80,268),'4 x M8',fontsize=10)
    p.draw_rect(fitz.Rect(300,290,570,375));p.draw_line((300,310),(570,310))
    p.insert_text((310,304),'WIDTH: 841 mm',fontsize=8)
    p.insert_text((310,324),'REVISION: R9',fontsize=8)
    p.insert_text((310,337),'SCALE: 1:2',fontsize=8)
    p.insert_text((310,350),'DRAWING NO: ABC-123',fontsize=8)
    p.insert_text((310,363),'THK: 99 mm',fontsize=8)
    p.insert_text((450,324),'MATERIAL: SS 304',fontsize=8)
    p.insert_text((450,337),'WEIGHT: 0.142 kg',fontsize=8)
    p.insert_text((450,350),'PLATE 900 x 700 x 90',fontsize=8)
    if raster:
        raster_doc=fitz.open(); q=raster_doc.new_page(width=600,height=400);q.insert_image(q.rect,pixmap=p.get_pixmap(matrix=fitz.Matrix(5,5),alpha=False));out=raster_doc.tobytes();raster_doc.close()
    else: out=doc.tobytes()
    doc.close();return out


def test_vector_product_only_and_correct_locate():
    content=fixture();raw,drawing,_,_,_=_local_fastapi_engineering_extract(content,'part-R55.pdf',False)
    assert raw['length_mm']==120 and raw['width_mm']==60
    assert drawing.thickness_mm==2.5 and drawing.weight_kg==pytest.approx(.142)
    assert drawing.drawing_no=='ABC-123' and drawing.revision=='R9'
    assert raw['material']['grade']=='AISI 304'
    assert not any(d['value_mm'] in (841,99,900,700,90,9,55) for d in raw['dimensions'])
    attach_pdf_evidence(raw,content)
    assert any(a['label']=='Width' and '60 mm' in a['callout'] and a['y']<.7 for a in raw['drawing_locations'])
    assert not any('841' in a['callout'] or 'THK: 99' in a['callout'] for a in raw['drawing_locations'])


def test_unlabelled_stock_and_filename_cannot_be_product_dimensions():
    doc=fitz.open();p=doc.new_page()
    for i,line in enumerate(['LENGTH 304 mm','4 x M8','2 x 45°','WIDTH: N/A','THICKNESS: N/A']):p.insert_text((50,50+25*i),line)
    raw,drawing,*_=_local_fastapi_engineering_extract(doc.tobytes(),'plate-900x800x50-R99.pdf',False);doc.close()
    assert raw['length_mm']==304 and raw['width_mm'] is None and drawing.thickness_mm==0
    assert not raw['material']['grade']
    assert raw['field_applicability']['width']=='not_applicable'
    assert raw['field_applicability']['thickness']=='not_applicable'
    assert raw['field_applicability']['height']=='review_required'


def test_missing_width_not_copied_or_inferred_from_local_features():
    doc=fitz.open();p=doc.new_page();p.insert_text((40,40),'LENGTH 100 mm');p.insert_text((40,80),'R8');p.insert_text((40,120),'MATERIAL SS 304');p.insert_text((40,160),'THK 2 mm')
    raw,drawing,*_=_local_fastapi_engineering_extract(doc.tobytes(),'test.pdf',False);doc.close()
    assert raw['width_mm'] is None
    assert drawing.weight_kg==0
    assert raw['field_applicability']['width']=='review_required'


def test_dimension_conflict_requires_review():
    doc=fitz.open();p=doc.new_page();p.insert_text((40,40),'THK 2 mm');p.insert_text((40,80),'THK 3 mm')
    raw,drawing,*_=_local_fastapi_engineering_extract(doc.tobytes(),'test.pdf',False);doc.close()
    assert drawing.thickness_mm==0 and 'Thickness' in raw['conflicting_fields']


def test_imperial_and_metric_dimension_units():
    doc=fitz.open();p=doc.new_page()
    for i,line in enumerate(['LENGTH 4 in','WIDTH 6 cm','THK 1/8 in','R0.1 in']):p.insert_text((50,60+i*25),line)
    content=doc.tobytes();doc.close();raw,drawing,*_=_local_fastapi_engineering_extract(content,'part.pdf',False)
    assert raw['length_mm']==pytest.approx(101.6)
    assert raw['width_mm']==pytest.approx(60)
    assert drawing.thickness_mm==pytest.approx(3.175)
    assert any(d["label"]=="Radius" and d["value_mm"]==pytest.approx(2.54) for d in raw["dimensions"])
    attach_pdf_evidence(raw,content)
    assert any(a['label']=='Thickness' for a in raw['drawing_locations'])


@pytest.mark.skipif(not shutil.which('tesseract'),reason='Tesseract unavailable')
def test_raster_footer_exclusion(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED','true')
    raw,drawing,*_=_local_fastapi_engineering_extract(fixture(True),'raster.pdf',True)
    assert raw['width_mm']==60 and drawing.thickness_mm==2.5
    assert not any(d['value_mm'] in (841,99,900,700,90,9) for d in raw['dimensions'])


def test_dxf_named_border_does_not_inflate_product_extents(tmp_path):
    ezdxf=pytest.importorskip('ezdxf');doc=ezdxf.new();doc.units=4;doc.layers.new('TITLE_BLOCK');m=doc.modelspace()
    m.add_lwpolyline([(0,0),(100,0),(100,60),(0,60)],close=True)
    m.add_lwpolyline([(-1000,-1000),(1000,-1000),(1000,1000),(-1000,1000)],close=True,dxfattribs={'layer':'TITLE_BLOCK'})
    m.add_text('THK 99',dxfattribs={'layer':'TITLE_BLOCK','insert':(100,100)})
    m.add_text('THK 3',dxfattribs={'insert':(10,10)})
    path=tmp_path/'part.dxf';doc.saveas(path);raw,drawing,*_=analyze_dxf_geometry(path.read_bytes(),'part.dxf')
    assert drawing.thickness_mm==3
    assert next(d['value_mm'] for d in raw['dimensions'] if d['label']=='Overall X')==100


def test_native_unlabelled_dimension_arrow_line():
    doc=fitz.open();p=doc.new_page(width=300,height=200)
    p.draw_line((50,50),(150,50));p.draw_line((50,50),(56,47));p.draw_line((50,50),(56,53));p.draw_line((150,50),(144,47));p.draw_line((150,50),(144,53))
    p.insert_text((90,46),'100',fontsize=8);p.insert_text((90,160),'777',fontsize=8)
    raw,*_=_local_fastapi_engineering_extract(doc.tobytes(),'part.pdf',False);doc.close()
    assert any(d['value_mm']==100 and d['label']=='Linear Dimension' for d in raw['dimensions'])
    assert not any(d['value_mm']==777 for d in raw['dimensions'])


def test_local_feature_dimensions_do_not_become_overall_dimensions():
    doc=fitz.open();p=doc.new_page()
    for i,line in enumerate(['OVERALL LENGTH 100 mm','SLOT WIDTH 8 mm','HOLE DEPTH 4 mm','THK 2 mm','MATERIAL SS 304']):p.insert_text((50,50+25*i),line)
    raw,drawing,*_=_local_fastapi_engineering_extract(doc.tobytes(),'part.pdf',False);doc.close()
    assert raw['length_mm']==100 and raw['width_mm'] is None and drawing.weight_kg==0


def test_api_source_recovery_ignores_footer_thickness(monkeypatch):
    import json
    from fastapi.testclient import TestClient
    from app.main import app
    from hashlib import sha256
    monkeypatch.setenv('LOCAL_OCR_ENABLED','false')
    doc=fitz.open();p=doc.new_page(width=600,height=400)
    p.insert_text((310,304),'THK 99 mm');p.insert_text((310,324),'REVISION R1');p.insert_text((310,350),'SCALE 1:2')
    content=doc.tobytes();doc.close()
    response=TestClient(app).post('/api/drawing/evidence',files={'file':('footer.pdf',content)},data={'engineering':json.dumps({'thickness_mm':0}),'expected_hash':sha256(content).hexdigest()})
    assert response.status_code==200,response.text
    assert not response.json().get('thickness_mm') and not response.json().get('drawing_locations')
