import fitz
from io import BytesIO
from openpyxl import load_workbook
from fastapi.testclient import TestClient
from app.main import app
from app.rfq_material import normalize_wall,recover_printed_thickness

client=TestClient(app)
def test_pipe_nested_classification():
    d={'engineering_intelligence':{'part_form':'Tube / Pipe'},'dimensions':[{'label':'OD','value_mm':50},{'label':'ID','value_mm':44}]}
    assert normalize_wall(d)==3

def test_printed_thickness():
    d={}
    assert recover_printed_thickness(d,'SHEET 2.5 mm THK')==2.5
    assert recover_printed_thickness({},'THK 2\nTHK 3') is None
    assert recover_printed_thickness({},'R2.1') is None

def test_recover_pdf_evidence():
    with fitz.open() as doc:
        page=doc.new_page();page.insert_text((40,60),'Thickness: 2.5 mm');content=doc.tobytes()
    result=client.post('/api/drawing/evidence',files={'file':('part.pdf',content,'application/pdf')},data={'engineering':'{"dimensions":[{"label":"Thickness","value_mm":2.5}]}'})
    assert result.status_code==200
    assert result.json()['evidence_preview'].startswith('data:image/jpeg;base64,')
    assert len(result.json()['drawing_locations'])==1

def test_full_export():
    result=client.post('/api/export/excel',json={'drawing':{'drawing_no':'D1','revision':'A','description':'Part','material':'SS304','thickness_mm':2.5,'weight_kg':1,'quantity':2},'rows':[],'summary':{'direct_cost':0,'material_wastage':0,'overhead':0,'manufacturing_cost':0,'markup':0,'selling_price':0},'customer':'=1+1','engineering':{'dimensions':[{'label':'Length','value_mm':20}]},'bom':[{'description':'Bolt','quantity':2}]})
    assert result.status_code==200
    wb=load_workbook(BytesIO(result.content));assert {'Cost Estimate','RFQ Details','Dimensions','BOM','Commercial Summary'}<=set(wb.sheetnames)
    assert wb['RFQ Details']['A2'].data_type!='f'
    assert wb['Dimensions']['B2'].value==20

def test_analyze_pdf_thickness_and_preview(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, '_gemini_extract_engineering', lambda *a,**kw: (None,'disabled for test'))
    with fitz.open() as doc:
        page=doc.new_page();page.insert_text((40,60),'SHEET SS304');page.insert_text((40,80),'Thickness: 2.5 mm');page.insert_text((40,100),'Length: 100 mm');page.insert_text((40,120),'Width: 60 mm');content=doc.tobytes()
    result=client.post('/api/analyze',files={'file':('sheet.pdf',content,'application/pdf')})
    assert result.status_code==200
    data=result.json();assert data['drawing']['thickness_mm']==2.5
    assert data['ai_raw']['thickness_mm']==2.5
    assert data['preview_image'].startswith('data:image/jpeg;base64,')
