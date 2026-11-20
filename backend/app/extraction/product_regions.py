"""Partition drawing callouts and administrative sheet text before extraction.

Coordinates are normalized to the displayed page. Never blanket-crop the bottom
of a drawing: real views can occupy it. Detect administrative rows/regions from
labels, and use explicit metadata only for its matching field.
"""
from __future__ import annotations
import re
from collections import defaultdict
from typing import Iterable

ADMIN = re.compile(r'\b(?:rev(?:ision)?\b|drawing\s*(?:no\.?|number|size)|dwg\s*(?:no\.?|number)|sheet\s*(?:no\.?|number|size)|scale\b|drawn(?:\s+by)?\b|checked(?:\s+by)?\b|approved(?:\s+by)?\b|designed(?:\s+by)?\b|date\b|issue\s+date|projection\b|paper\s+size|document\s*(?:no|number)|page\s*\d+\s*(?:of|/)|revision\s+history|change\s+description)\b', re.I)
MATERIAL = re.compile(r'\b(?:material(?:\s+grade)?|matl\.?|grade)\s*[:= ]', re.I)
WEIGHT = re.compile(r'\b(?:net\s+weight|unit\s+weight|weight|mass|wt\.?)\s*[:= ]', re.I)
PAPER = re.compile(r'\b(?:ISO\s*216|A[0-5]\s+(?:sheet|paper)|(?:sheet|paper)\s+A[0-5]|(?:paper|sheet|drawing|border|frame)\s+(?:width|height|length|dimensions?))\b', re.I)


def administrative(text):
    return bool(ADMIN.search(text) or PAPER.search(text))


def _page_grid(page):
    """Long horizontal table rules, not visual page size or drawing dimensions."""
    import fitz
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


def native_regions(content):
    import fitz
    from app.drawing_evidence import _pdf_lines
    regions=[]
    with fitz.open(stream=content,filetype='pdf') as doc:
        for i,p in enumerate(doc):
            rules=_page_grid(p)
            for text,boxes in _pdf_lines(p):
                box=fitz.Rect(boxes[0])
                for b in boxes[1:]: box |= b
                box=box*p.rotation_matrix
                r=p.rect
                if r.width and r.height:
                    regions.append({'page':i,'text':text.strip(),'box':[(box.x0-r.x0)/r.width,(box.y0-r.y0)/r.height,(box.x1-r.x0)/r.width,(box.y1-r.y0)/r.height],'score':1.0,'rules':rules})
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
        for r in rows:
            text=r['text']; x,y,x1,y1=r['box']; cx=(x+x1)/2; cy=(y+y1)/2
            inside=any(a<=cx<=c and b<=cy<=d for a,b,c,d in zones)
            if administrative(text) or inside:
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
    return text(product),'\n'.join(dict.fromkeys(typed)),text(all_regions),len(excluded)


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
    import fitz
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
            rows=[r for r in native_regions_for_page(page,i) if re.fullmatch(r'\s*'+_LENGTH_NUMBER+r'\s*(?:'+_LENGTH_UNITS+r')?\s*',r['text'],re.I)]
            # Exclusion happens on the same page/all labels, not just the bare values.
            allowed,_,_=partition(native_regions_for_page(page,i))
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
    import fitz
    from app.drawing_evidence import _pdf_lines
    rules=_page_grid(page);r=page.rect;rows=[]
    for text,boxes in _pdf_lines(page):
        box=fitz.Rect(boxes[0])
        for b in boxes[1:]: box|=b
        box=box*page.rotation_matrix
        rows.append({'page':index,'text':text.strip(),'box':[(box.x0-r.x0)/r.width,(box.y0-r.y0)/r.height,(box.x1-r.x0)/r.width,(box.y1-r.y0)/r.height],'score':1.,'rules':rules})
    return rows
