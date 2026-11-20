"""Validate all-page navigation, on-demand rendering and original-source identity."""
from hashlib import sha256
import fitz
from fastapi.testclient import TestClient
from app.main import app
from app.drawing_evidence import attach_pdf_evidence

client=TestClient(app)

def make_pdf(count=20):
    with fitz.open() as doc:
        for i in range(count):
            page=doc.new_page(width=400,height=300)
            page.insert_text((30,40),'Radius: 2.1 mm')
            if i==count-1: page.set_rotation(90)
        return doc.tobytes()


def test_all_anchors_remain_available_after_preview_cache_limit():
    raw=make_pdf()
    data={'dimensions':[{'label':'Radius','value_mm':2.1}]}
    attach_pdf_evidence(data,raw)
    assert data['evidence_page_count']==20
    assert len(data['evidence_pages'])==16
    assert {a['page'] for a in data['drawing_locations']}==set(range(20))
    assert '19' not in data['evidence_pages']


def test_page_endpoint_renders_uncached_rotated_page():
    raw=make_pdf()
    response=client.post('/api/drawing/page',files={'file':('drawing.pdf',raw)},data={'page':19,'expected_hash':sha256(raw).hexdigest()})
    assert response.status_code==200,response.text
    result=response.json()
    assert result['page']==19 and result['page_count']==20 and result['evidence_hash']==sha256(raw).hexdigest()
    assert result['image'].startswith('data:image/jpeg;base64,')
    from PIL import Image
    from io import BytesIO
    from base64 import b64decode
    with Image.open(BytesIO(b64decode(result['image'].split(',')[1]))) as im:
        assert im.height>im.width


def test_page_endpoint_rejects_out_of_range_and_wrong_source():
    raw=make_pdf(2)
    for page,digest,status in [(2,sha256(raw).hexdigest(),404),(-1,sha256(raw).hexdigest(),404),(0,'0'*64,409)]:
        r=client.post('/api/drawing/page',files={'file':('drawing.pdf',raw)},data={'page':page,'expected_hash':digest})
        assert r.status_code==status
    assert client.post('/api/drawing/page',files={'file':('drawing.dxf',b'wrong')},data={'page':0}).status_code==400
