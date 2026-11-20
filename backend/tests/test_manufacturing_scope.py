from app.engineering_intelligence import enrich_engineering_intelligence
from app.manufacturing_scope import standard_component, scope_from_notes
from app.drawing_evidence import attach_pdf_evidence
from app.main import _generate_bom, EngineeringArtifactReq, Drawing
import fitz

def test_classification_and_scope():
    data = enrich_engineering_intelligence({'description':'Pipe spool','notes':['Customer supplied parts, welding only']})
    assert data['manufacturing_category'] == 'Piping'
    assert data['quotation_scope'] == 'Welding only'
    assert scope_from_notes({'notes':['welding required']}) == 'Complete manufacturing'
    assert enrich_engineering_intelligence({'description':'Sheet metal cover'})['manufacturing_category'] == 'Sheet Metal'
    assert standard_component('90 degree elbow')
    assert not standard_component('custom machined flange')

def test_bom_standard_and_customer_supplied():
    data = {'assembly_parts':[{'part_name':'90 degree elbow','quantity':2},{'part_name':'Custom bracket','quantity':1}]}
    drawing = Drawing(drawing_no='A',revision='',description='Assembly',material='SS',thickness_mm=0,weight_kg=0,quantity=1,notes=[])
    report = _generate_bom(EngineeringArtifactReq(drawing=drawing,ai_raw=data))
    assert report['items'][0]['category'] == 'Standard Part'
    assert report['items'][0]['quantity'] == 2
    assert report['items'][1]['category'] == 'Manufactured Part'
    report = _generate_bom(EngineeringArtifactReq(drawing=drawing,ai_raw={**data,'quotation_scope':'Welding only'}))
    assert all(item['category']=='Customer Supplied' for item in report['items'])

def test_evidence_unique_callout():
    doc=fitz.open();page=doc.new_page();page.insert_text((50,50),'Length 150 mm');page.insert_text((50,100),'20 mm');page.insert_text((50,150),'20 mm')
    data={'dimensions':[{'label':'Length','value_mm':150,'callout':'Length 150 mm'},{'label':'Width','value_mm':20,'callout':'20 mm'}]}
    attach_pdf_evidence(data,doc.tobytes());doc.close()
    assert len(data['drawing_locations']) == 3
    assert data['drawing_locations'][0]['label']=='Length'
    assert data['drawing_locations'][0]['kind']=='verified'
    assert all(x['kind']=='candidate' for x in data['drawing_locations'] if x['label']=='Width')
    assert data['evidence_preview'].startswith('data:image/jpeg;base64,')
