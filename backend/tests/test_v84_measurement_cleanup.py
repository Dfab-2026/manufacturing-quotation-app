import fitz
from app.extraction.dimension_cleanup import clean_dimensions, dimension_name
from app.main import _local_fastapi_engineering_extract
from app.drawing_evidence import attach_pdf_evidence, normalized_label


def test_aliases_and_distinct_equal_axes():
    rows=[{'label':'Overall X','value_mm':40}, {'label':'Length X axis','value_mm':40}, {'label':'Overall Length (Predicted)','value_mm':0}, {'label':'Overall Y','value_mm':40}, {'label':'Linear Dimension','value_mm':40}, {'label':'Radius','value_mm':40}, {'label':'Hole diameter','value_mm':40}]
    clean=clean_dimensions(rows)
    assert [(dimension_name(r['label']),r['value_mm']) for r in clean]==[('Length',40),('Width',40),('Radius',40),('Hole diameter',40)]
    assert clean[0]['label']=='Overall X'
    assert normalized_label('Length X axis')=='length'


def test_conflicts_and_distinct_source_handles_preserved():
    rows=[{'label':'Thickness','value_mm':2},{'label':'THK','value_mm':3},{'label':'Linear Dimension','value_mm':40,'source_handle':'A'},{'label':'Linear Dimension','value_mm':40,'source_handle':'B'},{'label':'Radius','value_mm':3,'tolerance':'±0.1'},{'label':'Radius','value_mm':3,'tolerance':'±0.2'}]
    assert len(clean_dimensions(rows))==6


def test_product_only_and_repeat_tolerance():
    doc=fitz.open();p=doc.new_page(width=600,height=400)
    for i,line in enumerate(['LENGTH 120 mm','WIDTH 60 +0.2/-0.1 mm','THK 2.5 mm','60 mm','WIDTH 60 +0.2/-0.1 mm','R2.1','GENERAL TOLERANCE 999 +/- 1','UNLESS OTHERWISE SPECIFIED WIDTH 841 mm','PART NUMBER 900','REVISION 77']):
        p.insert_text((25,30+i*25),line,fontsize=10)
    content=doc.tobytes();doc.close()
    raw,drawing,*_=_local_fastapi_engineering_extract(content,'part.pdf',False)
    assert raw['width_mm']==60 and raw['length_mm']==120 and drawing.thickness_mm==2.5
    width=[r for r in raw['dimensions'] if dimension_name(r['label'])=='Width']
    assert len(width)==1 and width[0]['tolerance']=='+0.2/-0.1'
    assert not any(r['value_mm'] in (841,999,900,77) for r in raw['dimensions'])
    assert not any(dimension_name(r['label'])=='Linear Dimension' and r['value_mm']==60 for r in raw['dimensions'])
    attach_pdf_evidence(raw,content)
    assert any(a['label']=='Width' and '60' in a['callout'] for a in raw['drawing_locations'])
    assert not any('841' in a['callout'] or '999' in a['callout'] for a in raw['drawing_locations'])
