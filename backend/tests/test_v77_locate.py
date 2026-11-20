"""Regression coverage for the V77 source review and thickness recovery patch."""
import json
from hashlib import sha256
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.rfq_material import recover_printed_thickness, normalize_thickness
from app.drawing_evidence import attach_pdf_evidence

client = TestClient(app)


def pdf_bytes(*pages):
    with fitz.open() as doc:
        for lines in pages:
            p=doc.new_page(width=500,height=400)
            for i,line in enumerate(lines): p.insert_text((60,50+i*25),line)
        return doc.tobytes()


def recover(content, engineering, filename='part.pdf', expected_hash=None):
    return client.post('/api/drawing/evidence', files={'file':(filename,content)}, data={'engineering':json.dumps(engineering),'expected_hash':expected_hash or sha256(content).hexdigest()})


@pytest.mark.parametrize('text,expected', [
    ('THK. 2.5 MM',2.5),('Plate 100 x 60 x 3',3),('T=2.5',2.5),
    ('Thickness\n2.5 mm',2.5),('1/8 in THK',3.175),('Tube 50 x 3 wall',3),
    ('RHS 50 x 25 x 2',2),('3,5 mm THK',3.5),
])
def test_explicit_stock_formats(text,expected):
    data={}; assert recover_printed_thickness(data,text)==pytest.approx(expected)
    assert normalize_thickness(data)==pytest.approx(expected)
    assert data['dimensions'][-1]['callout']


def test_pipe_recovery_from_printed_od_id():
    content=pdf_bytes(['Tube','OD 50 mm','ID 44 mm'])
    response=recover(content,{'description':'Pipe','thickness_mm':0})
    assert response.status_code==200, response.text
    result=response.json();assert result['thickness_mm']==3
    anchors=[a for a in result['drawing_locations'] if a['label']=='Thickness']
    assert len(anchors)==2 and all(a['kind']=='calculation' for a in anchors)
    assert len({round(a['y'],3) for a in anchors})==2


def test_recovered_printed_thickness_and_page_position():
    content=pdf_bytes(['Part D100'],['Thickness: 2.5 mm','R2.1'])
    result=recover(content,{'thickness_mm':0,'dimensions':[{'label':'Thickness (Predicted)','value_mm':0},{'label':'Radius','value_mm':2.1}]}).json()
    assert result['thickness_mm']==2.5
    assert all(d['value_mm']>0 for d in result['dimensions'])
    anchor=next(a for a in result['drawing_locations'] if a['label']=='Thickness')
    assert anchor['page']==1 and '1' in result['evidence_pages']
    assert .1<anchor['x']<.6 and .05<anchor['y']<.3
    assert result['evidence_hash']==sha256(content).hexdigest()


def test_reject_mismatched_source():
    assert recover(pdf_bytes(['Thickness 2.5 mm']),{},expected_hash='0'*64).status_code==409


def test_weight_locates_printed_callout():
    data={'weight_kg':1.25,'weight_source':'drawing_stated','drawing_stated_weight_kg':1.25}
    attach_pdf_evidence(data,pdf_bytes(['Weight: 1250 g','Length: 1250 mm']))
    hits=[a for a in data['drawing_locations'] if a['label']=='Weight']
    assert len(hits)==1 and hits[0]['callout']=='Weight: 1250 g'


def test_weight_locates_calculated_inputs():
    data={'weight_kg':.25,'weight_source':'calculated_geometry','dimensions':[{'label':'Length','value_mm':100},{'label':'Width','value_mm':60}], 'thickness_mm':2.5}
    attach_pdf_evidence(data,pdf_bytes(['Length: 100 mm','Width: 60 mm','Thickness: 2.5 mm']))
    hits=[a for a in data['drawing_locations'] if a['label']=='Weight']
    assert len(hits)==3 and all(a['kind']=='calculation' for a in hits)
    assert len({round(a['y'],3) for a in hits})==3


def test_fraction_callout_coordinates():
    data={}; recover_printed_thickness(data,'THK 1/8 in')
    attach_pdf_evidence(data,pdf_bytes(['THK 1/8 in']))
    assert data['drawing_locations'][0]['value']=='3.175 mm'


def test_dxf_original_recovery(tmp_path):
    ezdxf=pytest.importorskip('ezdxf')
    doc=ezdxf.new();model=doc.modelspace();model.add_line((0,0),(100,0));model.add_text('Thickness: 2.5 mm',dxfattribs={'insert':(5,10),'height':3})
    file=tmp_path/'part.dxf';doc.saveas(file)
    response=recover(file.read_bytes(),{'thickness_mm':0},filename='part.dxf')
    assert response.status_code==200,response.text
    result=response.json();assert result['thickness_mm']==2.5
    assert any(a['label']=='Thickness' for a in result['drawing_locations'])


def test_real_step_plate_recovery(tmp_path):
    pytest.importorskip('OCP')
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
    from OCP.IFSelect import IFSelect_RetDone
    file=tmp_path/'plate.step';writer=STEPControl_Writer();writer.Transfer(BRepPrimAPI_MakeBox(100,60,3).Shape(),STEPControl_AsIs)
    assert writer.Write(str(file))==IFSelect_RetDone
    response=recover(file.read_bytes(),{'thickness_mm':0},filename='plate.step')
    assert response.status_code==200,response.text
    result=response.json();assert result['thickness_mm']==pytest.approx(3)
    assert any(g['label']=='Thickness' and g['points'] for g in result['geometry_locations'])


def test_no_fabricated_thickness_when_unknown():
    data={'description':'Unknown component','dimensions':[{'label':'Radius','value_mm':2.1}]}
    assert recover_printed_thickness(data,'R2.1') is None
    assert normalize_thickness(data) is None
    assert not data.get('thickness_mm')
