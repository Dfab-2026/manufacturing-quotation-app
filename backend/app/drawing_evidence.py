"""Source-backed drawing anchors. Only actual callouts or measured geometry are marked."""
from __future__ import annotations
import base64
import math
import re

EVIDENCE_VERSION = 7
_NUM = r'(?<![\d.,/])(?:\d+\s*[- ]\s*\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)(?![\d.,/])'
_LABELS = {
    'thickness': r'(?:wall\s+thickness|thickness|thk\.?|thick|gauge|sheet|plate|\bt\s*[:=])',
    'length': r'(?:length|long|\blg\b|\bl\s*[:=])',
    'width': r'(?:width|wide|\bw\s*[:=])',
    'height': r'(?:height|high|\bh\s*[:=])',
    'outer diameter': r'(?:outer\s+dia(?:meter)?|outside\s+dia(?:meter)?|external\s+dia(?:meter)?|\bo\.?d\.?\b)',
    'inner diameter': r'(?:inner\s+dia(?:meter)?|inside\s+dia(?:meter)?|internal\s+dia(?:meter)?|\bi\.?d\.?\b)',
    'radius': r'(?:radius|\br\s*(?=\d))',
    'diameter': r'(?:diameter|\bdia\.?|[Øø⌀∅])',
    'chamfer': r'(?:chamfer|\bc\s*(?=\d))',
    'weight': r'(?:weight|mass|\bwt\.?\b)',
}


def normalized_label(label):
    label = re.sub(r'\s*\([^)]*\)', '', str(label or '').lower()).strip()
    label = re.sub(r'^(overall|primary)\s+', '', label)
    if re.search(r'\b(?:outer|outside|external)\b|^o\.?d\.?$',label): return 'outer diameter'
    if re.search(r'\b(?:inner|inside|internal)\b|^i\.?d\.?$',label): return 'inner diameter'
    if re.search(r'thickness|\bthk\b|gauge',label): return 'thickness'
    if label in ('x','length'): return 'length'
    if label in ('y','width'): return 'width'
    if label in ('z','height','depth'): return 'height'
    if 'radius' in label: return 'radius'
    if 'diameter' in label or 'hole' in label or 'ø' in label: return 'diameter'
    if 'chamfer' in label: return 'chamfer'
    return label


def _positive(value):
    try:
        val=float(value)
        return val if math.isfinite(val) and val>0 else 0
    except (TypeError,ValueError): return 0


def _features(data):
    out=[]
    def add(label,value,feature=None,unit='mm'):
        val=_positive(value)
        if val: out.append((str(label),val,unit,feature or {}))
    for item in data.get('dimensions') or []:
        if isinstance(item,dict): add(item.get('label') or 'Dimension',item.get('value_mm'),item)
    for key,label,field in [('holes','Hole diameter','diameter_mm'),('bends','Bend radius','radius_mm'),('chamfers','Chamfer','size_mm')]:
        for item in data.get(key) or []:
            if isinstance(item,dict): add(label,item.get(field),item)
    for field,label in [('length_mm','Length'),('width_mm','Width'),('height_mm','Height'),('thickness_mm','Thickness')]:
        value=_positive(data.get(field))
        if value and not any(normalized_label(a)==normalized_label(label) and abs(b-value)<1e-6 for a,b,_,_ in out):
            add(label,value,{'source':data.get('thickness_basis','') if field=='thickness_mm' else ''})
    add('Weight',data.get('drawing_stated_weight_kg') or data.get('weight_kg'),unit='kg')
    return out[:200]


def _pdf_lines(page):
    """Return text plus exact character boxes, including individually rotated text."""
    import fitz
    for block in page.get_text('rawdict',flags=fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks']:
        for line in block.get('lines',[]):
            chars=[]; boxes=[]
            for span in line.get('spans',[]):
                for c in span.get('chars',[]):
                    for ch in c.get('c',''):
                        chars.append(ch);boxes.append(fitz.Rect(c['bbox']))
            if chars: yield ''.join(chars),boxes


def _text_hit_score(text, match, label, unit, callout):
    """Prefer explicit semantics, then real standalone dimensions. Not arbitrary title-block numbers."""
    left=text[:match.start()];right=text[match.end():]
    near=left[-42:]+match.group()+right[:28]
    if unit=='kg':
        if re.match(r'\s*(?:kg|g|grams?|lbs?|pounds?)\b',right,re.I) or re.search(_LABELS['weight']+r'\s*[:=]?\s*$',left,re.I): return 5
        return 0
    if re.match(r'\s*(?:kg|g\b|°|deg\b|MPa\b|%|rpm\b)',right,re.I): return 0
    # Avoid tolerances, drawing/revision identifiers, grade designations and dates.
    if re.search(r'(?:±|\+/-|[+\-])\s*$',left) and not re.match(r'\s*mm\b',right,re.I): return 0
    if re.search(r'\b(?:drawing\s*(?:no|number)|revision|material\s*grade|date|scale|qty|quantity)\b',text,re.I) and not re.search(_LABELS.get(label,r'(?!)'),near,re.I): return 0
    if callout:
        clean=lambda s:re.sub(r'\s+','',s).casefold()
        if clean(callout) in clean(text) and re.search(r'\d',callout): return 6
    pattern=_LABELS.get(label)
    if pattern:
        tag=re.search(pattern,near,re.I)
        if tag:
            # Semantically tagged values are stronger than generic dimensions.
            if label in ('outer diameter','inner diameter'):
                return 5
            if label in ('thickness','length','width','height','weight'):
                # Require label adjacent to token; a line containing dimensions for other axes must not match all of them.
                before=re.search(pattern+r'\s*[:=×x\-]?\s*$',left,re.I)
                after=re.match(r'\s*(?:mm\b\s*)?'+pattern,right,re.I)
                if before or after: return 5
            elif label in ('radius','diameter','chamfer'):
                if re.search(pattern+r'\s*[:=]?\s*$',left,re.I) or re.match(r'\s*(?:mm\b\s*)?'+pattern,right,re.I): return 5
    # Standalone dimension callouts or standard tolerance suffixes, not arbitrary number substrings.
    bare = re.fullmatch(r'\s*\(?\s*'+_NUM+r'\s*(?:mm)?\s*(?:±\s*\d+(?:[.,]\d+)?)?\s*\)?\s*',text,re.I)
    if bare and label not in ('radius','diameter','outer diameter','inner diameter','chamfer','weight'): return 2
    if label in ('outer diameter','inner diameter','diameter') and re.search(r'(?:[Øø⌀∅]|\bdia\.?)\s*$',left,re.I): return 2
    if label=='radius' and re.search(r'\bR\s*$',left,re.I): return 5
    return 0


def _find_anchors(data,lines,preview):
    import fitz
    locations=[]; seen=set()
    # Build candidates for every dimension with source semantics. Multiple real
    # matching callouts are retained, never silently reduced to an arbitrary point.
    for label,value,unit,feature in _features(data):
        sem=normalized_label(label); callout=str(feature.get('callout') or '').strip()
        candidates=[]
        for i,text,boxes,rect,rotation in lines:
            for match in re.finditer(_NUM,text):
                try:
                    token=match.group().replace(',','.')
                    fraction=re.fullmatch(r'(?:(\d+)\s*[- ]\s*)?(\d+)/(\d+)',token)
                    if fraction:
                        whole,numerator,denominator=(int(v or 0) for v in fraction.groups())
                        if not denominator: continue
                        number=whole+numerator/denominator
                    else: number=float(token)
                except ValueError: continue
                if unit=='mm':
                    from app.extraction.product_regions import explicit_unit_factor
                    number*=explicit_unit_factor(text[match.end():])
                # Displayed roundoff is allowed only at sub-micron precision.
                if unit=='kg' and re.match(r'\s*(?:g|grams?)\b',text[match.end():],re.I): number/=1000
                elif unit=='kg' and re.match(r'\s*(?:lbs?|pounds?)\b',text[match.end():],re.I): number*=.45359237
                if abs(number-value)>max(1e-6,abs(value)*1e-7): continue
                score=_text_hit_score(text,match,sem,unit,callout)
                if score<=0: continue
                hit=fitz.Rect(boxes[match.start()])
                for b in boxes[match.start()+1:match.end()]: hit|=b
                hit=hit*rotation
                if rect.width<=0 or rect.height<=0: continue
                hit &= rect
                if hit.is_empty:continue
                candidates.append((score,i,hit,rect,text.strip()))
        if not candidates: continue
        best=max(x[0] for x in candidates)
        hits=[x for x in candidates if x[0]==best]
        # A labelled or explicit source callout is verified; a plain number with
        # matching value may not identify which geometric axis it represents.
        for score,i,hit,rect,text in hits[:30]:
            if not preview(i): continue
            x=(hit.x0-rect.x0)/rect.width;y=(hit.y0-rect.y0)/rect.height
            w=hit.width/rect.width;h=hit.height/rect.height
            key=(label.casefold(),round(value,6),i,round(x,5),round(y,5))
            if key in seen:continue
            seen.add(key)
            locations.append({'label':label,'value':f'{value:.8g} {unit}','page':i,'x':x,'y':y,'w':w,'h':h,'kind':'verified' if score>=5 and len(hits)==1 else 'candidate','callout':text[:220]})
    # Calculated wall thickness is sourced from OD and ID rather than a fake thickness dot.
    if _positive(data.get('thickness_mm')) and re.search(r'OD|inner.*outer|paired.*diameter',str(data.get('thickness_basis','')),re.I):
        for loc in list(locations):
            if normalized_label(loc['label']) not in ('inner diameter','outer diameter'): continue
            locations.append({**loc,'label':'Thickness','value':f"{float(data['thickness_mm']):.8g} mm",'kind':'calculation','callout':f"{loc['label']}: {loc['callout']} (contributes to calculated thickness)"})
    # Derived thickness and weight point to the actual dimension inputs, not
    # a synthetic callout at an arbitrary position in the drawing.
    thickness=_positive(data.get('thickness_mm'))
    basis=str(data.get('thickness_basis') or '')
    if thickness and 'envelope' in basis.lower():
        for loc in list(locations):
            if normalized_label(loc['label']) in ('length','width','height') and abs(float(loc['value'].split()[0])-thickness)<1e-5:
                locations.append({**loc,'label':'Thickness','kind':'calculation','callout':'Thickness estimate from '+loc['callout']})
    weight=_positive(data.get('weight_kg'))
    if weight and not any(normalized_label(loc['label'])=='weight' for loc in locations) and not _positive(data.get('drawing_stated_weight_kg')) and data.get('weight_source') in ('geometry_prediction','calculated_geometry','cad_solid_volume','predicted','calculated'):
        for loc in list(locations):
            if normalized_label(loc['label']) in ('length','width','height','thickness','outer diameter','inner diameter'):
                locations.append({**loc,'label':'Weight','value':f'{weight:.8g} kg','kind':'calculation','callout':'Weight input: '+loc['callout']})
    return locations[:500]



def _partitioned_anchors(data, lines, preview, native=None):
    """Use the identical product-region policy for extraction and Locate."""
    import fitz
    from app.extraction.product_regions import partition
    regions=[]
    for idx,(page,text,boxes,rect,rotation) in enumerate(lines):
        if not boxes: continue
        box=fitz.Rect(boxes[0])
        for b in boxes[1:]: box|=b
        box=box*rotation
        if not rect.width or not rect.height: continue
        r={'page':page,'text':text,'score':1.0,'box':[(box.x0-rect.x0)/rect.width,(box.y0-rect.y0)/rect.height,(box.x1-rect.x0)/rect.width,(box.y1-rect.y0)/rect.height],'index':idx}
        if native and page in native: r['rules']=native[page]
        regions.append(r)
    product,metadata,_=partition(regions)
    positioned=[lines[r['index']] for r in product]
    anchors=_find_anchors(data,positioned,preview)
    if _positive(data.get('drawing_stated_weight_kg')) or data.get('weight_source')=='drawing_stated':
        weight_data={'weight_kg':data.get('drawing_stated_weight_kg') or data.get('weight_kg')}
        meta_lines=[lines[r['index']] for r in metadata]
        for item in _find_anchors(weight_data,meta_lines,preview):
            if item not in anchors: anchors.append(item)
    # Historical records may not carry the weight source tag. A matching
    # explicit Weight/Mass callout is sufficient, never a generic kg value.
    elif _positive(data.get('weight_kg')) and not data.get('weight_source'):
        weight_data={'weight_kg':data.get('weight_kg')}
        anchors.extend(_find_anchors(weight_data,[lines[r['index']] for r in metadata],preview))
    return anchors[:500],positioned

def render_pdf_evidence_page(content, index):
    """Render only the requested page; keep large PDFs out of saved quotation payloads."""
    import fitz
    with fitz.open(stream=content,filetype='pdf') as doc:
        if not 0<=index<len(doc): raise IndexError('Drawing page out of range')
        page=doc[index]; scale=min(4.0,2400/max(page.rect.width,page.rect.height,1))
        pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
        return 'data:image/jpeg;base64,'+base64.b64encode(pix.tobytes('jpeg',jpg_quality=90)).decode('ascii'),len(doc)


def attach_pdf_evidence(data, content):
    import fitz
    with fitz.open(stream=content,filetype='pdf') as doc:
        if not len(doc):return
        previews={}
        def preview(index):
            if str(index) in previews: return True
            if len(previews)>=16:return True  # Coordinates remain valid; render remaining pages on demand.
            page=doc[index];scale=min(2.0,1800/max(page.rect.width,page.rect.height,1))
            pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
            previews[str(index)]='data:image/jpeg;base64,'+base64.b64encode(pix.tobytes('jpeg',jpg_quality=88)).decode('ascii')
            return True
        preview(0)
        lines=[]
        for i,page in enumerate(doc):
            for text,boxes in _pdf_lines(page):
                lines.append((i,text,boxes,page.rect,page.rotation_matrix))
        from app.extraction.detail_ocr import cached_regions
        for region in data.get('optical_text_regions') or cached_regions(content):
            if not isinstance(region,dict) or float(region.get('score') or 0)<.70: continue
            i=int(region['page']); text=str(region['text'])
            if not 0<=i<len(doc) or not text:continue
            rect=doc[i].rect; x,y,x1,y1=region['box']
            box=fitz.Rect(x*rect.width,y*rect.height,x1*rect.width,y1*rect.height)
            # Native text is the more precise source when an optical region
            # rereads the same printed callout. Keep optical-only annotations.
            clean=lambda value: re.sub(r'\s+','',str(value)).casefold()
            duplicates=False
            for page_index,native_text,native_boxes,_,rotation in lines:
                if page_index!=i or clean(native_text)!=clean(text) or not native_boxes:continue
                native=fitz.Rect(native_boxes[0])
                for item in native_boxes[1:]: native|=item
                native=native*rotation
                intersection=native & box
                if not intersection.is_empty and intersection.get_area()>=.45*min(native.get_area(),box.get_area()):
                    duplicates=True;break
            if not duplicates:
                lines.append((i,text,[box]*len(text),rect,fitz.Matrix(1,1)))
        from app.extraction.product_regions import _page_grid
        rules={i:_page_grid(p) for i,p in enumerate(doc)}
        data['drawing_locations'],_=_partitioned_anchors(data,lines,preview,native=rules)
        data['evidence_preview']=previews['0']; data['evidence_pages']=previews
        data['evidence_page_count']=len(doc)
        data['evidence_version']=EVIDENCE_VERSION


def attach_image_evidence(data, content, ocr=None):
    """Image preview with source anchors when local OCR provides trustworthy positions."""
    from io import BytesIO
    from PIL import Image,ImageOps
    import fitz
    with Image.open(BytesIO(content)) as original:
        image=ImageOps.exif_transpose(original).convert('RGB')
        image.thumbnail((1800,1800))
        out=BytesIO();image.save(out,format='JPEG',quality=90)
        data['evidence_preview']='data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode('ascii')
        data['evidence_pages']={'0':data['evidence_preview']}
        data['drawing_locations']=[]
        from app.extraction.detail_ocr import cached_regions
        regions=data.get('optical_text_regions') or cached_regions(content)
        if regions:
            lines=[]
            for r in regions:
                if r.get('page')!=0 or float(r.get('score') or 0)<.70:continue
                x,y,x1,y1=r['box']; text=str(r['text'])
                box=fitz.Rect(x*image.width,y*image.height,x1*image.width,y1*image.height)
                lines.append((0,text,[box]*len(text),fitz.Rect(0,0,image.width,image.height),fitz.Matrix(1,1)))
            from app.rfq_material import recover_printed_thickness,normalize_thickness
            _,product_lines=_partitioned_anchors({},lines,lambda _:True)
            recover_printed_thickness(data,'\n'.join(line[1] for line in product_lines))
            normalize_thickness(data)
            data['drawing_locations'],_=_partitioned_anchors(data,lines,lambda _:True)
        elif ocr is not None:
            try:
                import numpy as np
                result=ocr(np.asarray(image))
                lines=[]
                texts=getattr(result,'txts',None); boxes=getattr(result,'boxes',None); scores=getattr(result,'scores',None)
                if texts is not None and boxes is not None and scores is not None:
                    for text,corners,score in zip(texts,boxes,scores):
                        if float(score)<.8 or not text:continue
                        xs=[float(x[0]) for x in corners];ys=[float(x[1]) for x in corners]
                        b=fitz.Rect(min(xs),min(ys),max(xs),max(ys))
                        # OCR boxes cover the whole recognized annotation; don't invent character-level locations.
                        lines.append((0,str(text),[b]*len(str(text)),fitz.Rect(0,0,image.width,image.height),fitz.Matrix(1,1)))
                from app.rfq_material import recover_printed_thickness,normalize_thickness
                _,product_lines=_partitioned_anchors({},lines,lambda _:True)
                recover_printed_thickness(data,'\n'.join(line[1] for line in product_lines))
                normalize_thickness(data)
                data['drawing_locations'],_=_partitioned_anchors(data,lines,lambda _:True)
            except Exception: pass
        data['evidence_version']=EVIDENCE_VERSION


def attach_dxf_evidence(data,content):
    """Render DXF model space and associate the real drawing records with source entities."""
    import tempfile
    from pathlib import Path
    import ezdxf
    from ezdxf.addons.drawing import Frontend,RenderContext,layout,config
    from ezdxf.addons.drawing.pymupdf import PyMuPdfBackend
    import fitz
    with tempfile.NamedTemporaryFile(suffix='.dxf',delete=False) as file:
        file.write(content); name=file.name
    try:
        doc=ezdxf.readfile(name)
        model=doc.modelspace()
        backend=PyMuPdfBackend()
        drawing_config=config.Configuration(background_policy=config.BackgroundPolicy.WHITE, color_policy=config.ColorPolicy.BLACK, hatching_timeout=2)
        Frontend(RenderContext(doc),backend,drawing_config).draw_layout(model,finalize=True)
        target=backend.get_replay(layout.Page(297,210,margins=layout.Margins.all(5)))
        pdf=target.get_pdf_bytes()
        with fitz.open(stream=pdf,filetype='pdf') as rendered:
            page=rendered[0];rect=page.rect
            scale=min(2.0,1800/max(rect.width,rect.height,1))
            image='data:image/jpeg;base64,'+base64.b64encode(page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).tobytes('jpeg',jpg_quality=88)).decode('ascii')
        # The replay maps recorder geometry to PDF coordinates in-place. Handles
        # link these exact visible bounds to the original model-space entities.
        bounds={}
        for recording,props in backend.player().recordings():
            key=str(props.handle or '')
            b=recording.bbox()
            if not key or not b.has_data:continue
            hit=fitz.Rect(b.extmin.x,b.extmin.y,b.extmax.x,b.extmax.y)
            # Degenerate horizontal/vertical lines still need a visible source region.
            if hit.width<1:hit.x0-=.5;hit.x1+=.5
            if hit.height<1:hit.y0-=.5;hit.y1+=.5
            bounds[key]=bounds.get(key,fitz.Rect(hit))|hit
        lines=[];locations=[];seen=set()
        from app.extraction.product_regions import dxf_administrative, administrative
        for entity in model:
            if dxf_administrative(entity): continue
            handle=str(entity.dxf.handle or '')
            hit=bounds.get(handle)
            if hit is None: continue
            typ=entity.dxftype()
            if typ=='TEXT':text=str(entity.dxf.text or '')
            elif typ=='MTEXT':text=str(entity.plain_text() or '')
            else:text=''
            if text and not administrative(text):lines.append((0,text,[hit]*len(text),rect,fitz.Matrix(1,1)))
        locations.extend(_find_anchors(data,lines,lambda _:True))
        features=_features(data)
        def loc(label,val,handle,basis):
            hit=bounds.get(handle)
            if hit is None:return
            hit=hit&rect
            if hit.is_empty:return
            key=(label,val,handle)
            if key in seen:return
            seen.add(key)
            locations.append({'label':label,'value':f'{val:.8g} mm','page':0,'x':hit.x0/rect.width,'y':hit.y0/rect.height,'w':hit.width/rect.width,'h':hit.height/rect.height,'kind':'geometry','callout':basis})
        for label,value,unit,feature in features:
            if unit=='mm' and feature.get('source_handle'):
                loc(label,value,str(feature['source_handle']),f"DXF entity {feature['source_handle']} · measured geometry")
        # Extents come from the whole profile, not a single arbitrary point. The
        # rendered profile bounds identify the geometric envelope as such.
        profile_bounds=[bounds[str(e.dxf.handle)] for e in model if not dxf_administrative(e) and e.dxftype() in {'LINE','ARC','CIRCLE','ELLIPSE','LWPOLYLINE','POLYLINE','SPLINE','3DFACE','SOLID','INSERT'} and str(e.dxf.handle) in bounds]
        if profile_bounds:
            envelope=fitz.Rect(profile_bounds[0])
            for hit in profile_bounds[1:]:envelope|=hit
            for label,val,unit,_ in features:
                if unit=='mm' and label.lower() in ('overall x','overall y'):
                    for x,y in ((envelope.x0,envelope.y1),(envelope.x1,envelope.y1)) if label.lower()=='overall x' else ((envelope.x0,envelope.y0),(envelope.x0,envelope.y1)):
                        if 0<=x<=rect.width and 0<=y<=rect.height:
                            locations.append({'label':label,'value':f'{val:.8g} mm','page':0,'x':max(0,x-3)/rect.width,'y':max(0,y-3)/rect.height,'w':6/rect.width,'h':6/rect.height,'kind':'geometry','callout':'DXF profile envelope extrema'})
        data['drawing_locations']=locations[:500];data['evidence_preview']=image;data['evidence_pages']={'0':image};data['evidence_version']=EVIDENCE_VERSION
    finally:
        Path(name).unlink(missing_ok=True)
