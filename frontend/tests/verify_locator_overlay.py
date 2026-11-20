import sys
from pathlib import Path
import fitz
from playwright.sync_api import sync_playwright
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'backend'))
from app.drawing_evidence import attach_pdf_evidence
# Actual PDF callout on rotated second page; use actual normalized source rectangle.
with fitz.open() as doc:
 doc.new_page(width=600,height=400)
 p=doc.new_page(width=600,height=400);p.insert_text((150,120),'Radius: 2.1 mm');p.set_rotation(90)
 pdf=doc.tobytes()
data={'dimensions':[{'label':'Radius','value_mm':2.1}]};attach_pdf_evidence(data,pdf)
a=data['drawing_locations'][0];assert a['page']==1
style=(root/'frontend/app/globals.css').read_text();image=data['evidence_pages']['1'];left=(a['x']+a['w']/2)*100;top=(a['y']+a['h']/2)*100
html=f'''<!doctype html><html><head><style>{style}</style></head><body><div class="drawing-evidence-preview"><div class="drawing-locator-image-stage"><img src="{image}"><div class="drawing-locator-overlay"><div class="drawing-locator-anchor" data-side="right" style="left:{left}%;top:{top}%;width:{a['w']*100}%;height:{a['h']*100}%"><span class="drawing-locator-pin"><span class="drawing-locator-dot"></span><span class="drawing-locator-pulse"></span></span></div></div></div></div></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=__import__('os').environ.get('CHROMIUM_PATH') or None,args=['--no-sandbox','--disable-dev-shm-usage']);page=browser.new_page(reduced_motion='reduce');page.set_content(html);page.locator('.drawing-locator-image-stage img').evaluate('(el)=>el.decode()')
 for width in [360,768,1280]:
  page.set_viewport_size({'width':width,'height':900});img=page.locator('.drawing-locator-image-stage img').bounding_box();dot=page.locator('.drawing-locator-dot').bounding_box();pin=page.locator('.drawing-locator-pin').bounding_box();
  anchor=page.locator('.drawing-locator-anchor').bounding_box()
  assert abs(anchor['x']+anchor['width']/2-(img['x']+img['width']*left/100))<1.5
  assert abs(anchor['y']+anchor['height']/2-(img['y']+img['height']*top/100))<1.5
  assert dot['x'] >= anchor['x']+anchor['width']+2
  assert abs(dot['y']+dot['height']/2-(anchor['y']+anchor['height']/2))<1.5
  assert pin['width']<=12 and dot['width']<=6
  assert page.locator('.drawing-locator-dot').is_visible()
  print(f'Chromium compact offset marker alignment PASS: {width}px viewport, rotated PDF page 2')
 browser.close()
