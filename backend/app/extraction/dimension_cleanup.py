"""Consolidate extraction aliases without inventing axes or removing distinct features."""
import math
import re


def dimension_name(label):
    text = re.sub(r'\s*\((?:predicted|review(?: required)?)\)\s*$', '', str(label or ''), flags=re.I).strip()
    s = re.sub(r'^(overall|primary|total)\s+', '', text.lower()).replace('-', ' ')
    s = re.sub(r'\(([xyz])(?:[ -]axis)?\)', r' \1', s)
    s = re.sub(r'\s+', ' ', s).strip()
    for name, axis in [('Length','x'),('Width','y'),('Height','z')]:
        if s in (name.lower(), axis, f'{axis} axis', f'{name.lower()} {axis}', f'{name.lower()} {axis} axis', f'{axis} axis {name.lower()}', f'{axis} dimension'):
            return name
    if s in ('thk','thick','thickness','wall thickness','sheet thickness','plate thickness','gauge'): return 'Thickness'
    if s in ('linear dimension','dimension'): return 'Linear Dimension'
    if s in ('od','o.d.','o.d','outside diameter','outer diameter','external diameter'): return 'Outer Diameter'
    if s in ('id','i.d.','i.d','inside diameter','inner diameter','internal diameter'): return 'Inner Diameter'
    if re.fullmatch(r'hole\s*[ø⌀∅]\s*[\d.,]+',s): return 'Hole diameter'
    return text


def clean_dimensions(rows):
    result=[]
    def value(row):
        try:
            v=float(row.get('value_mm') or 0)
            return round(v,6) if math.isfinite(v) and v>0 else 0
        except (ValueError,TypeError): return 0
    def name(row): return dimension_name(row.get('label')).casefold()
    def quantity(row):
        try: return max(1,int(row.get('quantity') or 1))
        except (ValueError, TypeError, OverflowError): return 1
    def compatible(a,b):
        # Different explicit tolerances, entity handles and feature quantities
        # are physical evidence, not duplicates.
        for k in ('tolerance','source_handle','kind'):
            if a.get(k) and b.get(k) and a[k]!=b[k]: return False
        return not (quantity(a)>1 and quantity(b)>1 and quantity(a)!=quantity(b))
    for row in rows or []:
        if not isinstance(row,dict): continue
        row=dict(row); n=name(row); v=value(row)
        if not n: continue
        if v and n in ('length','width','height','thickness'):
            # Remove placeholder for the now resolved same field.
            result=[r for r in result if not (name(r)==n and not value(r))]
        if not v and any(name(r)==n and value(r) for r in result): continue
        match=next((r for r in result if name(r)==n and value(r)==v and compatible(r,row)),None)
        if match is not None:
            # Keep legacy axis labels internally for CAD geometry anchors; merge
            # richer metadata, not counts (repeated views aren't extra parts).
            for k,x in row.items():
                if x is not None and x!='' and (not match.get(k) or k in ('confidence','quantity') and isinstance(x,(float,int)) and isinstance(match.get(k,0),(float,int)) and x>match.get(k,0)): match[k]=x
            continue
        result.append(row)
    # Plain generic readback of an already named dimension is redundant. A
    # distinct explicit tolerance, handle, or feature callout must survive.
    return [r for r in result if not (name(r)=='linear dimension' and value(r)>0 and not r.get('source_handle') and any(name(q) in ('length','width','height','thickness') and value(q)==value(r) and compatible(q,r) and (not r.get('tolerance') or q.get('tolerance')==r.get('tolerance')) for q in result))]
