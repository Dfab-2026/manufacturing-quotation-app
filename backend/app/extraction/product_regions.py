"""Partition drawing callouts and administrative sheet text before extraction.

Coordinates are normalized to the displayed page. Never blanket-crop the bottom
of a drawing: real views can occupy it. Detect administrative rows/regions from
labels, and use explicit metadata only for its matching field.
"""
from __future__ import annotations
import json
import re
from collections import OrderedDict, defaultdict
from hashlib import sha256
from threading import Lock
from typing import Iterable

ADMIN = re.compile(r'\b(?:rev(?:ision)?\b|drawing\s*(?:no\.?|number|size)|dwg\s*(?:no\.?|number)|sheet\s*(?:no\.?|number|size)|scale\b|drawn(?:\s+by)?\b|checked(?:\s+by)?\b|approved(?:\s+by)?\b|designed(?:\s+by)?\b|date\b|issue\s+date|projection\b|paper\s+size|document\s*(?:no|number)|page\s*\d+\s*(?:of|/)|revision\s+history|change\s+description)\b', re.I)
MATERIAL = re.compile(r'\b(?:material(?:\s+grade)?|matl\.?|grade)\s*[:= ]', re.I)
WEIGHT = re.compile(r'\b(?:net\s+weight|unit\s+weight|weight|mass|wt\.?)\s*[:= ]', re.I)
PAPER = re.compile(r'\b(?:ISO\s*216|A[0-5]\s+(?:sheet|paper)|(?:sheet|paper)\s+A[0-5]|(?:paper|sheet|drawing|border|frame)\s+(?:width|height|length|dimensions?))\b', re.I)

# Cache only compact extracted strings, never uploaded PDF bytes or page images.
# A single analysis revisits the identical title block during thickness recovery,
# evidence attachment and costing; re-rendering the page on every pass can stall
# Render, particularly with multi-page CAD sheets.
_SOURCE_TEXT_LOCK = Lock()
_SOURCE_TEXT_CACHE: OrderedDict[str, tuple[str, str, str, int]] = OrderedDict()
_SOURCE_TEXT_CACHE_SIZE = 3
_SOURCE_TEXT_CACHE_MAX_CHARS = 160_000



NON_GEOMETRY = re.compile(r"^\s*(?:(?:general|standard|unspecified|default)\s+tolerances?\b|unless\s+otherwise\s+(?:specified|stated|noted)\b|do\s+not\s+scale\b|all\s+dimensions\s+(?:are\s+)?in\b|(?:sheet|page)\s+\d+\s*(?:of|/)\s*\d+|(?:drawing|document|part)\s+(?:no\.?|number|id)\b|(?:copyright|confidential|proprietary)\b|(?:note|notes)\s*[:.]?\s*(?:general|all\s+dimensions|unless\s+otherwise))", re.I)


def administrative(text):
    return bool(ADMIN.search(text) or PAPER.search(text) or NON_GEOMETRY.search(text))


def _page_grid(page):
    """Long horizontal table rules, not visual page size or drawing dimensions."""
    import pymupdf as fitz
    r=page.rect; rules=[]
    try: drawings=page.get_drawings()
    except Exception: return rules
    for path in drawings:
        for item in path.get('items',[]):
            if item[0]=='l': segments=[(item[1],item[2])]
            elif item[0]=='re':
                box=item[1]
                segments=[(box.tl,box.tr),(box.bl,box.br)]
            else: continue
            for a,b in segments:
                a=a*page.rotation_matrix; b=b*page.rotation_matrix
                x,x1=sorted(((a.x-r.x0)/r.width,(b.x-r.x0)/r.width)); y=(a.y+b.y-2*r.y0)/(2*r.height)
                if abs(a.y-b.y)/r.height<.0015 and x1-x>=.18 and .01<y<.99:
                    rules.append((x,y,x1))
    return rules


def _image_content_boxes(image):
    """Find actual closed table cells from long horizontal/vertical rules.

    Work on the page image, so scanned and vector drawings use the same rules.
    A page frame or large component outline is not itself a content cell.
    """
    try:
        import cv2
        import numpy as np
        from PIL import Image
        image=image.convert('L'); image.thumbnail((1800,1800))
        gray=np.asarray(image); h,w=gray.shape
        if min(h,w)<20: return []
        ink=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV|cv2.THRESH_OTSU)[1]
        horizontal=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(12,w//45),1)))
        vertical=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,max(10,h//65))))
        grid=cv2.morphologyEx(horizontal|vertical,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        contours,_=cv2.findContours(grid,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
        boxes=[]
        for contour in contours:
            x,y,bw,bh=cv2.boundingRect(contour)
            if bw<w*.035 or bh<h*.012 or bw>w*.97 or bh>h*.26: continue
            if cv2.contourArea(contour)<.78*bw*bh: continue
            # Four ruled sides, not a dimension line or isolated character.
            t=max(2,round(min(w,h)*.003))
            if min(np.count_nonzero(horizontal[max(0,y-t):y+t+1,x:x+bw].max(axis=0))/bw,
                   np.count_nonzero(horizontal[max(0,y+bh-t-1):min(h,y+bh+t),x:x+bw].max(axis=0))/bw,
                   np.count_nonzero(vertical[y:y+bh,max(0,x-t):x+t+1].max(axis=1))/bh,
                   np.count_nonzero(vertical[y:y+bh,max(0,x+bw-t-1):min(w,x+bw+t)].max(axis=1))/bh)<.65: continue
            boxes.append((x/w,y/h,(x+bw)/w,(y+bh)/h))
        return boxes
    except (ImportError, ValueError, RuntimeError):
        return []


def _page_content_boxes(page):
    from PIL import Image
    import pymupdf as fitz
    scale=1600/max(page.rect.width,page.rect.height,1)
    pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csGRAY,alpha=False)
    return _image_content_boxes(Image.frombytes('L',(pix.width,pix.height),pix.samples))


def _boxed_text(row, rows, boxes):
    x,y,x1,y1=row['box']; cx=(x+x1)/2; cy=(y+y1)/2
    for a,b,c,d in boxes:
        if not (a<cx<c and b<cy<d and x>=a-.006 and x1<=c+.006): continue
        # Text tightly contained in a ruled cell, multi-row content panel,
        # or neighbouring ruled cells. Do not discard a lone dimension
        # inside a large rectangular component outline.
        contained=[q for q in rows if a<(q['box'][0]+q['box'][2])/2<c and b<(q['box'][1]+q['box'][3])/2<d]
        tight=(d-b)<=max(.035,3*(y1-y)) and (c-a)<=max(.16,8*(x1-x))
        adjacent=any(abs(e-c)<.008 or abs(g-a)<.008 for e,f,g,h in boxes if min(d,h)-max(b,f)>.5*min(d-b,h-f)) or any(abs(f-d)<.008 or abs(h-b)<.008 for e,f,g,h in boxes if min(c,g)-max(a,e)>.5*min(c-a,g-e))
        if tight or adjacent or len(contained)>=2: return True
    return False

def native_regions(content):
    import pymupdf as fitz
    from app.drawing_evidence import _pdf_lines
    regions=[]
    with fitz.open(stream=content,filetype='pdf') as doc:
        for i,p in enumerate(doc):
            rules=_page_grid(p); boxes_on_page=_page_content_boxes(p)
            for text,boxes in _pdf_lines(p):
                box=fitz.Rect(boxes[0])
                for b in boxes[1:]: box |= b
                box=box*p.rotation_matrix
                r=p.rect
                if r.width and r.height:
                    regions.append({'page':i,'text':text.strip(),'box':[(box.x0-r.x0)/r.width,(box.y0-r.y0)/r.height,(box.x1-r.x0)/r.width,(box.y1-r.y0)/r.height],'score':1.0,'rules':rules,'content_boxes':boxes_on_page})
    return regions


def partition(regions):
    """Return product, metadata, excluded. A footer requires corroborating admin labels.

    A local lower-right title block is kept local unless anchors span the sheet.
    A single administrative line never excludes an entire part view.
    """
    pages=defaultdict(list)
    for r in regions:
        if isinstance(r,dict) and r.get('text') and len(r.get('box',[]))==4 and float(r.get('score',1))>=.70:
            pages[r.get('page',0)].append(r)
    product=[]; metadata=[]; excluded=[]
    for rows in pages.values():
        admin=[r for r in rows if administrative(r['text'])]
        # Footer labels clustered in bottom 30%; top revision table handled
        # separately when its labels cluster in the upper 20%.
        zones=[]
        for group, edge in (([r for r in admin if r['box'][1]>=.70], 'bottom'),([r for r in admin if r['box'][3]<=.20 and re.search(r'\brev|\bdate|\bapproved|\bchange',r['text'],re.I)],'top')):
            signatures={m.group(0).casefold() for r in group for m in ADMIN.finditer(r['text'])}
            if len(signatures)<2: continue
            xs=[r['box'][0] for r in group]; xe=[r['box'][2] for r in group]
            ys=[r['box'][1] for r in group]; ye=[r['box'][3] for r in group]
            # A tight band around the identified table. Include split value
            # rows and local unlabeled cells, not an arbitrary full bottom crop.
            x0=max(0,min(xs)-.07); x1=min(1,max(xe)+.23)
            if max(xe)-min(xs)>.55: x0,x1=0,1
            y0=max(0,min(ys)-(.075 if edge=='bottom' else .025)); y1=min(1,max(ye)+.05)
            if edge=='bottom':
                y1=1
                # Prefer the nearest visible table separator above the admin
                # labels. This also catches numeric/size cells in earlier rows.
                rules=next((r.get('rules') for r in rows if r.get('rules')),[])
                eligible=[(a,b,c) for a,b,c in rules if .60<=b<=min(ys) and min(ys)-b<=.13 and a<=min(xs)+.02 and c>=max(xe)-.02]
                if eligible:
                    a,b,c=min(eligible,key=lambda v:v[1]); x0=min(x0,a); x1=max(x1,c); y0=min(y0,b)
            zones.append((x0,y0,x1,y1))
        boxes=next((r.get('content_boxes') for r in rows if r.get('content_boxes')),[])
        for r in rows:
            text=r['text']; x,y,x1,y1=r['box']; cx=(x+x1)/2; cy=(y+y1)/2
            inside=any(a<=cx<=c and b<=cy<=d for a,b,c,d in zones)
            if administrative(text) or inside or _boxed_text(r,rows,boxes):
                excluded.append(r)
                # Material and printed product weight have their own explicit
                # fields; never expose the rest of an administrative row as geometry.
                if MATERIAL.search(text) or WEIGHT.search(text): metadata.append(r)
            elif MATERIAL.search(text) or WEIGHT.search(text):
                metadata.append(r)
                # Material stock callouts such as MATERIAL: SS304 PLATE 3 mm
                # are engineering context only if outside administrative zone.
                if MATERIAL.search(text): product.append(r)
            else: product.append(r)
    return product,metadata,excluded


def source_text(content, filename, optical=()):
    optical = list(optical)
    cache_key = None
    if len(content) <= 25 * 1024 * 1024 and len(optical) <= 1200:
        try:
            fingerprint = sha256(json.dumps(optical, sort_keys=True, default=str).encode('utf-8')).hexdigest()
            cache_key = f"{filename.lower().endswith('.pdf')}:{sha256(content).hexdigest()}:{fingerprint}"
            with _SOURCE_TEXT_LOCK:
                cached = _SOURCE_TEXT_CACHE.get(cache_key)
                if cached is not None:
                    _SOURCE_TEXT_CACHE.move_to_end(cache_key)
                    return cached
        except (TypeError, ValueError):
            cache_key = None
    native=native_regions(content) if filename.lower().endswith('.pdf') else []
    # Preserve native and OCR locations. Deduplicate only matching text in the
    # same page region, not equal callouts in different views.
    all_regions=list(native)
    for r in optical:
        if not isinstance(r,dict) or len(r.get('box',[]))!=4: continue
        key=re.sub(r'\s+','',str(r.get('text',''))).casefold()
        def same(n):
            if n['page']!=r.get('page') or re.sub(r'\s+','',n['text']).casefold()!=key: return False
            a,b=n['box'],r['box']; return abs((a[0]+a[2]-b[0]-b[2])/2)<.015 and abs((a[1]+a[3]-b[1]-b[3])/2)<.015
        if not any(same(n) for n in native): all_regions.append(r)
    # Optical-only rows must inherit the same page geometry as native rows.
    if filename.lower().endswith('.pdf'):
        import pymupdf as fitz
        page_boxes={r['page']:r.get('content_boxes',[]) for r in native}
        with fitz.open(stream=content,filetype='pdf') as doc:
            for i in {r.get('page',0) for r in all_regions}:
                if i not in page_boxes and 0<=i<len(doc): page_boxes[i]=_page_content_boxes(doc[i])
    else:
        from PIL import Image,ImageOps
        from io import BytesIO
        try:
            with Image.open(BytesIO(content)) as im: page_boxes={0:_image_content_boxes(ImageOps.exif_transpose(im))}
        except (OSError,ValueError): page_boxes={}
    all_regions=[{**r,'content_boxes':page_boxes.get(r.get('page',0),[])} for r in all_regions]
    product,metadata,excluded=partition(all_regions)
    def text(rows):
        rows=sorted(rows,key=lambda r:(r.get('page',0),round(r['box'][1],3),r['box'][0]))
        return '\n'.join(dict.fromkeys(r['text'] for r in rows))
    typed=[]
    for row in metadata:
        line=row['text']
        for pattern in (MATERIAL, WEIGHT):
            for m in pattern.finditer(line):
                tail=line[m.end():]
                # Split at next administrative or material/weight label.
                stops=[v.start() for p in (ADMIN,PAPER,MATERIAL,WEIGHT) if (v:=p.search(tail))]
                if stops: tail=tail[:min(stops)]
                if pattern is MATERIAL:
                    # Keep only material specifications; do not carry a numeric
                    # width or arbitrary table cell into the material parser.
                    tail=re.split(r'\b(?:width|height|length|thickness|size|qty|quantity)\b',tail,maxsplit=1,flags=re.I)[0]
                typed.append(m.group(0)+tail.strip())
    # Some CAD title blocks print the label and value in separate neighbouring
    # cells (for example MATERIAL | SS 316 and WEIGHT | 0.142 kg). Those cells
    # are metadata only: never feed their numbers into the dimension extractor.
    # Pair only explicit labels with a physically adjacent, valid value.
    for label_row in all_regions:
        label = ' '.join(str(label_row.get('text') or '').split()).strip().rstrip(':').strip()
        is_material = bool(re.fullmatch(r'(?:MATERIAL(?:\s+GRADE)?|MATL\.?|GRADE)', label, re.I))
        is_weight = bool(re.fullmatch(r'(?:NET\s+WEIGHT|UNIT\s+WEIGHT|WEIGHT|MASS|WT\.?)(?:\s*\(\s*(?:KG|G|LB)\s*\))?', label, re.I))
        if not (is_material or is_weight):
            continue
        a, b, c, d = label_row['box']
        mid_y = (b + d) / 2
        matches = []
        for candidate in all_regions:
            if candidate is label_row or candidate.get('page') != label_row.get('page'):
                continue
            x, y, x1, y1 = candidate['box']
            if x < c - .005 or x - c > .32:
                continue
            if abs((y + y1) / 2 - mid_y) > max(.014, (d - b) * .9):
                continue
            value = ' '.join(str(candidate.get('text') or '').split()).strip()
            if is_material:
                valid = re.search(
                    r'\b(?:AISI|SUS|SS\s*[-/]?\s*(?:201|202|304L?|316L?|321|430)|'
                    r'(?:201|202|304L?|316L?|321|430)\s*SS|'
                    r'STAINLESS\s+STEEL|MILD\s+STEEL|CARBON\s+STEEL|'
                    r'IS\s*2062|ASTM\s*A240|ALUMINIUM|ALUMINUM|COPPER|BRASS)\b',
                    value, re.I,
                )
                valid = bool(valid)
            else:
                valid = bool(re.fullmatch(r'\d+(?:[.,]\d+)?\s*(?:KG|KGS|G|GRAMS?|LB|LBS|POUNDS?)', value, re.I))
            if valid:
                matches.append((x - c, value))
        if matches:
            value = min(matches, key=lambda item: item[0])[1]
            typed.append(f'{label}: {value}')
    result = (text(product), '\n'.join(dict.fromkeys(typed)), text(all_regions), len(excluded))
    if cache_key is not None and sum(len(part) for part in result[:3]) <= _SOURCE_TEXT_CACHE_MAX_CHARS:
        with _SOURCE_TEXT_LOCK:
            _SOURCE_TEXT_CACHE[cache_key] = result
            _SOURCE_TEXT_CACHE.move_to_end(cache_key)
            while len(_SOURCE_TEXT_CACHE) > _SOURCE_TEXT_CACHE_SIZE:
                _SOURCE_TEXT_CACHE.popitem(last=False)
    return result


def geometry_text(content, filename, optical=()):
    return source_text(content,filename,optical)[0]


def dxf_administrative(entity):
    """Honor explicitly named non-product layers/blocks in model space."""
    layer=str(getattr(entity.dxf,'layer',''))
    name=str(getattr(entity.dxf,'name','')) if entity.dxftype()=='INSERT' else ''
    return bool(re.search(r'(?:^|[^a-z0-9])(?:title(?:[ _-]*block)?|revision|rev[ _-]*table|border|frame|sheet[ _-]*format|paper[ _-]*space|stamp)(?:$|[^a-z0-9])',layer+' '+name,re.I))

# Explicit unit conversions only. Never treat thread pitch, page number, scale,
# quantity or revision code as a physical unit. All downstream numeric fields
# stay millimetres; original text is retained in the coordinate index.
_LENGTH_UNITS=r'(?:millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|inches|inch|feet|foot|mm|cm|ft|in|m)(?![A-Za-z0-9])|["\']'
_FACTORS={'mm':1.,'cm':10.,'m':1000.,'in':25.4,'ft':304.8,'"':25.4,"'":304.8,'inch':25.4,'inches':25.4,'foot':304.8,'feet':304.8}
_LENGTH_NUMBER=r'(?:\d+\s*[- ]\s*\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?|[.,]\d+)'


def unit_factor(unit):
    unit=str(unit).lower().strip()
    if unit.startswith('millimet'): return 1.
    if unit.startswith('centimet'): return 10.
    if unit.startswith('met'): return 1000.
    return _FACTORS.get(unit,1.)


def explicit_unit_factor(suffix):
    match=re.match(r'\s*('+_LENGTH_UNITS+r')',suffix,re.I)
    return unit_factor(match.group(1)) if match else 1.


def number_value(token):
    fraction=re.fullmatch(r'(?:(\d+)\s*[- ]\s*)?(\d+)/(\d+)',token.strip())
    if fraction:
        whole,num,den=(int(v or 0) for v in fraction.groups())
        return whole+num/den if den else 0
    try: return float(token.replace(',','.'))
    except ValueError: return 0


def normalize_length_units(text):
    """Normalize explicit metric/imperial callouts without changing counts/angles.

    Trailing unit for a clearly labeled product stock tuple applies to the
    entire tuple. Fractions and decimal comma are accepted when explicitly
    dimensioned. Raw source text and position are never replaced.
    """
    tuple_pattern=re.compile(r'(?P<prefix>\b(?:overall(?:\s+size)?|size|stock(?:\s+size)?|blank|plate|sheet|rhs|shs)\s*[:=\-]?\s*)(?P<tuple>'+_LENGTH_NUMBER+r'\s*[x×]\s*'+_LENGTH_NUMBER+r'(?:\s*[x×]\s*'+_LENGTH_NUMBER+r')?)\s*(?P<unit>'+_LENGTH_UNITS+r')',re.I)
    pattern=re.compile(r'(?:(?<![\d\w.,/])|(?<=[RrØø⌀∅]))(?P<value>'+_LENGTH_NUMBER+r')\s*(?P<unit>'+_LENGTH_UNITS+r')',re.I)
    def line_normalized(line):
        if administrative(line): return ''
        def stock(m):
            nums=re.split(r'\s*[x×]\s*',m.group('tuple')); factor=unit_factor(m.group('unit'))
            return m.group('prefix')+' x '.join(f'{number_value(n)*factor:.9g}' for n in nums)+' mm'
        line=tuple_pattern.sub(stock,line)
        # A metric thread designation (M8 x 1.25) isn't a length tuple.
        def single(m):
            unit=m.group('unit'); val=number_value(m.group('value'))
            if unit.casefold()=='in' and re.match(r'\s+[a-z]',line[m.end():],re.I): return m.group(0)
            if val<=0: return m.group(0)
            return f'{val*unit_factor(unit):.9g} mm'
        return pattern.sub(single,line)
    return '\n'.join(line_normalized(line) for line in str(text or '').splitlines())


def field_applicability(data, text):
    """Missing measurement is unknown, not N/A. Require explicit source proof."""
    states={}
    for field,key in [('length','length_mm'),('width','width_mm'),('height','height_mm'),('thickness','thickness_mm'),('weight','weight_kg')]:
        if data.get(key): continue
        if field.capitalize() in (data.get('conflicting_fields') or []):
            states[field]='review_required';continue
        explicit=re.search(r'\b'+field+r'\s*(?:\(mm\)|\(kg\))?\s*[:=\-]?\s*(?:N\s*/\s*A\b|NOT\s+APPLICABLE\b)',text,re.I)
        # An explicit solid-round form has no wall thickness. A guessed turning
        # category or just the word SHAFT is insufficient to assert this.
        solid=field in ('thickness','width','height') and re.search(r'\bSOLID\s+(?:ROUND\s+BAR|CYLINDER|CYLINDRICAL\s+(?:BAR|SHAFT)|SHAFT)\b',text,re.I) and not re.search(r'\b(?:BORE|HOLLOW|TUBE|PIPE)\b',text,re.I)
        states[field]='not_applicable' if explicit or solid else 'review_required'
    return states


def vector_dimension_callouts(content):
    """Read standalone native numeric callouts backed by a drawn dimension line.

    A number on a page is not enough. Require a nearby horizontal/vertical
    dimension segment plus two arrowheads constructed from short angled strokes.
    Return generic linear measurements, not inferred overall axes.
    """
    import math
    import pymupdf as fitz
    found=[]
    with fitz.open(stream=content,filetype='pdf') as doc:
        for i,page in enumerate(doc):
            segments=[]
            for path in page.get_drawings():
                for item in path.get('items',[]):
                    if item[0]=='l':
                        a,b=item[1]*page.rotation_matrix,item[2]*page.rotation_matrix
                        if abs(a-b)>0: segments.append((a,b))
            # Restrict to candidate dimension baselines and short arrow strokes.
            if len(segments)>15000: continue
            arrows=[(a,b) for a,b in segments if .5<abs(a-b)<18 and abs(a.x-b.x)>.4 and abs(a.y-b.y)>.4]
            baselines=[(a,b) for a,b in segments if abs(a-b)>12 and (abs(a.x-b.x)<.5 or abs(a.y-b.y)<.5)]
            page_rows=native_regions_for_page(page,i)
            rows=[r for r in page_rows if re.fullmatch(r'\s*'+_LENGTH_NUMBER+r'\s*(?:'+_LENGTH_UNITS+r')?\s*',r['text'],re.I)]
            # Exclusion happens on the same page/all labels, not just the bare values.
            allowed,_,_=partition(page_rows)
            allowed_keys={(r['text'],tuple(r['box'])) for r in allowed}
            for row in rows:
                if (row['text'],tuple(row['box'])) not in allowed_keys: continue
                x,y,x1,y1=row['box']; rect=page.rect
                center=fitz.Point((x+x1)/2*rect.width+rect.x0,(y+y1)/2*rect.height+rect.y0)
                def arrow_at(point):
                    return sum(min(abs(a-point),abs(b-point))<2.2 for a,b in arrows)>=2
                for a,b in baselines:
                    horizontal=abs(a.y-b.y)<.5
                    coord=center.x if horizontal else center.y
                    low,high=sorted((a.x,b.x) if horizontal else (a.y,b.y))
                    offset=abs(center.y-a.y) if horizontal else abs(center.x-a.x)
                    if low-3<=coord<=high+3 and offset<=18 and arrow_at(a) and arrow_at(b):
                        text=normalize_length_units(row['text']);m=re.match(_LENGTH_NUMBER,text.strip());v=number_value(m.group(0)) if m else 0
                        if v>0: found.append((v,row['text']))
                        break
    return found


def native_regions_for_page(page,index):
    import pymupdf as fitz
    from app.drawing_evidence import _pdf_lines
    rules=_page_grid(page);content_boxes=_page_content_boxes(page);r=page.rect;rows=[]
    for text,boxes in _pdf_lines(page):
        box=fitz.Rect(boxes[0])
        for b in boxes[1:]: box|=b
        box=box*page.rotation_matrix
        rows.append({'page':index,'text':text.strip(),'box':[(box.x0-r.x0)/r.width,(box.y0-r.y0)/r.height,(box.x1-r.x0)/r.width,(box.y1-r.y0)/r.height],'score':1.,'rules':rules,'content_boxes':content_boxes})
    return rows
