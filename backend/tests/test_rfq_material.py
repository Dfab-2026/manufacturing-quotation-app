from app.rfq_material import normalize_wall, purchased_callouts
from app.drawing_evidence import attach_pdf_evidence
import fitz

def test_wall():
    d={'description':'Pipe','dimensions':[{'label':'OD','value_mm':50},{'label':'ID','value_mm':44}]}
    assert normalize_wall(d)==3
    assert d['thickness_mm']==3 and d['mandatory_fields']['thickness_mm']

def test_ambiguous_wall():
    d={'description':'Pipe','dimensions':[{'label':'OD','value_mm':50},{'label':'OD','value_mm':60},{'label':'ID','value_mm':44}]}
    assert normalize_wall(d) is None

def test_bom_callouts():
    assert purchased_callouts('4 Nos M8 x 25 bolts\n4 Nos bolt holes') == [{'description':'Bolt','specification':'M8 x 25','quantity':4,'source':'4 Nos M8 x 25 bolts'}]

def test_second_page_radius():
    doc=fitz.open();doc.new_page();p=doc.new_page();p.insert_text((50,50),'R2.1');content=doc.tobytes();doc.close()
    data={'dimensions':[{'label':'Radius','value_mm':2.1}]};attach_pdf_evidence(data,content)
    assert data['drawing_locations'][0]['page']==1
