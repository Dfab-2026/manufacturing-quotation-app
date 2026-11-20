import fitz
from app.drawing_evidence import attach_pdf_evidence

def test_drawing_image_without_callouts():
    doc = fitz.open(); doc.new_page(); content = doc.tobytes(); doc.close()
    data = {}
    attach_pdf_evidence(data, content)
    assert data['evidence_preview'].startswith('data:image/jpeg;base64,')
    assert data['drawing_locations'] == []


def test_additional_feature_locations_are_source_specific():
    with fitz.open() as doc:
        page=doc.new_page(width=500,height=400)
        page.insert_text((40,50),'HOLE DEPTH 12 mm')
        page.insert_text((40,90),'BEND 45 deg')
        page.insert_text((40,130),'12')
        data={'holes':[{'depth_mm':12,'callout':'HOLE DEPTH 12 mm'}], 'bends':[{'angle_deg':45,'callout':'BEND 45 deg'}]}
        attach_pdf_evidence(data,doc.tobytes())
    depth=[a for a in data['drawing_locations'] if a['label']=='Hole depth']
    angle=[a for a in data['drawing_locations'] if a['label']=='Bend angle']
    assert len(depth)==1 and depth[0]['y']<.2
    assert len(angle)==1 and .15<angle[0]['y']<.3


def test_no_fabricated_feature_source_without_callout():
    with fitz.open() as doc:
        page=doc.new_page(width=500,height=400);page.insert_text((40,50),'12')
        data={'holes':[{'depth_mm':12}]};attach_pdf_evidence(data,doc.tobytes())
    assert not any(a['label']=='Hole depth' for a in data['drawing_locations'])
