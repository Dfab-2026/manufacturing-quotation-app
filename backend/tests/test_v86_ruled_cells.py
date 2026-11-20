import fitz
from app.extraction.product_regions import source_text, _page_content_boxes
from app.main import _local_fastapi_engineering_extract
from app.drawing_evidence import attach_pdf_evidence

def drawing(raster=False):
    d=fitz.open(); p=d.new_page(width=600,height=400)
    p.draw_rect(fitz.Rect(50,70,250,180))
    for text,point in [('LENGTH 120 mm',(70,55)),('WIDTH 60 mm',(70,200)),('THK 3 mm',(70,220))]: p.insert_text(point,text)
    # A table with no revision/title keywords, in the middle-right of the page.
    p.draw_rect(fitz.Rect(280,100,570,190));p.draw_line((280,145),(570,145));p.draw_line((420,100),(420,190))
    for text,point in [('THK 99 mm',(290,125)),('WIDTH 841 mm',(430,125)),('LENGTH 999 mm',(290,170)),('R77',(430,170))]: p.insert_text(point,text)
    if not raster: return d.tobytes()
    r=fitz.open();q=r.new_page(width=600,height=400);q.insert_image(q.rect,pixmap=p.get_pixmap(matrix=fitz.Matrix(3,3)));return r.tobytes()

def test_unlabelled_table_excluded_from_measurements_and_sources():
    content=drawing();data,*_=_local_fastapi_engineering_extract(content,'part.pdf',False)
    assert data['length_mm']==120 and data['width_mm']==60 and data['thickness_mm']==3
    assert not any(d['value_mm'] in (99,841,999,77) for d in data['dimensions'])
    attach_pdf_evidence(data,content)
    assert not any('841' in a['callout'] or '99 mm' in a['callout'] for a in data['drawing_locations'])

def test_raster_grid_filters_optical_regions_without_native_text():
    content=drawing(True)
    optical=[{'page':0,'text':'WIDTH 841 mm','box':[.72,.28,.90,.32],'score':.99},{'page':0,'text':'WIDTH 60 mm','box':[.12,.47,.29,.51],'score':.99}]
    product,_,_,_=source_text(content,'part.pdf',optical)
    assert '60 mm' in product and '841' not in product

def test_standalone_note_box_excluded_but_bottom_product_dimension_retained():
    d=fitz.open(); p=d.new_page(width=600,height=400)
    p.draw_rect(fitz.Rect(50,220,250,335));p.insert_text((65,350),'LENGTH 120 mm');p.insert_text((65,370),'WIDTH 60 mm')
    p.draw_rect(fitz.Rect(325,45,570,95));p.insert_text((335,65),'LENGTH 888 mm');p.insert_text((335,85),'THK 99 mm')
    content=d.tobytes();d.close()
    raw,*_=_local_fastapi_engineering_extract(content,'part.pdf',False)
    assert raw['length_mm']==120 and raw['width_mm']==60
    assert not raw['thickness_mm']
    assert not any(x['value_mm'] in (888,99) for x in raw['dimensions'])
