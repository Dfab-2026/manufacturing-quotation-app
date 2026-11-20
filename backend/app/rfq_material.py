"""Conservative dimensional and purchasing normalization for RFQ review."""
import math
import re


def positive(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else 0
    except (ValueError, TypeError):
        return 0


def pipe_dimensions(data):
    dimensions = data.get('dimensions') or []
    def unique(pattern):
        vals = {round(positive(d.get('value_mm')), 6) for d in dimensions if isinstance(d, dict) and re.fullmatch(pattern, str(d.get('label') or '').strip(), re.I)} - {0}
        return next(iter(vals)) if len(vals) == 1 else 0
    od = unique(r'(?:overall |primary )?(?:outer|outside|external) dia(?:meter)?(?:\s*\(.*\))?|O\.?D\.?')
    ident = unique(r'(?:overall |primary )?(?:inner|inside|internal) dia(?:meter)?(?:\s*\(.*\))?|I\.?D\.?')
    return od, ident


def normalize_wall(data):
    form = ' '.join(str(data.get(k) or '') for k in ('manufacturing_category', 'part_form', 'description', 'primary_manufacturing_type')) + ' ' + str((data.get('engineering_intelligence') or {}).get('part_form') or '')
    if re.search(r'rectangular|square|\brhs\b|\bshs\b', form, re.I):
        return None
    od, ident = pipe_dimensions(data)
    if not od > ident > 0 or not re.search(r'pipe|piping|tube|hollow|bush|sleeve|cylindrical|shaft|turning', form, re.I):
        return None
    thickness = round((od-ident)/2, 6)
    old = positive(data.get('thickness_mm'))
    if old and abs(old-thickness) > max(.01, thickness*.01):
        data.setdefault('missing_or_uncertain', []).append('Wall thickness conflicts with extracted OD and ID; confirm section dimensions.')
        return None
    data['thickness_mm'] = thickness
    data['thickness_basis'] = '(OD − ID) / 2'
    data.setdefault('mandatory_fields', {})['thickness_mm'] = True
    data['missing_or_uncertain'] = [v for v in data.get('missing_or_uncertain', []) if not re.search(r'thickness.*(?:missing|not detected|could not|not found)|(?:missing|confirm).*thickness', str(v), re.I)]
    if not any(re.search(r'thickness|thk', str(d.get('label','')), re.I) and positive(d.get('value_mm')) for d in data.get('dimensions', []) if isinstance(d,dict)):
        data.setdefault('dimensions', []).append({'label':'Wall Thickness','value_mm':thickness,'confidence':90,'callout':'','source':'Calculated from OD and ID'})
    return thickness


PART = re.compile(r'\b(?:hex(?:agon)?\s+bolt|socket\s+(?:head\s+)?screw|bolt|nut|washer|screw|stud|rivet|flange|elbow|tee|reducer|coupling|gasket|bearing|circlip)s?\b', re.I)
def purchased_callouts(text):
    """Explicit quantity callouts only; never mistake bolt holes for bolts."""
    result = []
    for line in str(text or '').splitlines():
        if re.search(r'\b(?:holes?|clearance|PCD|drill|pitch circle)\b', line, re.I): continue
        m = PART.search(line)
        if not m: continue
        q = re.search(r'\b(?:qty\.?\s*[:=]?\s*(\d+)|(\d+)\s*(?:nos?\.?|pcs\.?|off)\b)',line,re.I)
        if not q:
            # Hardware list rows such as "Hex bolt M8 x 25 4" are not
            # inferred: the trailing number can be part of the specification.
            q = re.search(r'\b(\d+)\s*(?:x|×)\s*(?=(?:M\d+|bolt|nut|washer|screw)\b)',line,re.I)
            if not q: continue
            qty = int(q.group(1))
        else:
            qty = int(q.group(1) or q.group(2))
        if not 0 < qty < 100000: continue
        spec = re.search(r'\bM\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?',line,re.I)
        row = {'description':m.group().rstrip("sS").title(),'specification':spec.group() if spec else '', 'quantity':qty,'source':line.strip()[:250]}
        if row not in result: result.append(row)
    return result


def recover_printed_thickness(data, text):
    """Resolve printed stock/wall callouts; retain the exact source line for Locate."""
    if positive(data.get('thickness_mm')) or 'Thickness' in (data.get('conflicting_fields') or []): return None
    if data.get('assembly_parts') or data.get('manufacturing_category') == 'Assembly': return None
    # Accept decimals, fractions and mixed fractions. Explicit unit suffixes only.
    num = r'(\d+(?:[.,]\d+)?(?:\s*[- ]\s*\d+/\d+|/\d+)?)'
    unit = r'(mm|inches|inch|in\b|")?'
    label = r'(?:wall\s+thickness|thickness|thk\.?|thick(?:ness)?|\bt\s*[:=])'
    patterns = [r'\b'+label+r'\s*[:=]?\s*'+num+r'\s*'+unit,
                num+r'\s*'+unit+r'\s*(?:thk\.?|thick(?:ness)?)\b',
                r'\b(?:sheet|plate|strip|flat|HDG|steel sheet)\s*[:=]?\s*'+num+r'\s*(mm)\b(?!\s*[x×])']
    def measurement(value, units=''):
        token=value.replace(',', '.').strip()
        fraction=re.fullmatch(r'(?:(\d+)\s*[- ]\s*)?(\d+)/(\d+)',token)
        if fraction:
            whole,numerator,denominator=(int(v or 0) for v in fraction.groups())
            val=whole+numerator/denominator if denominator else 0
        else: val=positive(token)
        return val*(25.4 if units and units.lower()!='mm' else 1)
    candidates={}
    def record(value, line):
        if 0<value<=500: candidates.setdefault(round(value,6),line.strip()[:220])
    source=str(text or '')
    source_lines=source.splitlines()
    # Separate PDF text spans can yield the thickness label on one line and
    # its numeric value on the next. Only combine an isolated label and value.
    joined_lines=[source_lines[i]+' '+source_lines[i+1] for i in range(len(source_lines)-1) if re.fullmatch(r'\s*(?:wall\s+thickness|thickness|thk\.?|thick|t)\s*[:=]?\s*',source_lines[i],re.I) and re.fullmatch(r'\s*'+num+r'\s*'+unit+r'\s*',source_lines[i+1],re.I)]
    for line in [*source_lines,*joined_lines]:
        for pattern in patterns:
            for match in re.finditer(pattern,line,re.I):
                record(measurement(match.group(1),match.group(2) or ''),line)
        # Standard stock callout: L x W x thickness, with the stock form explicit.
        for match in re.finditer(r'\b(?:plate|sheet|strip|flat\s+bar|blank|rhs|shs|rectangular\s+tube|square\s+tube)\s*[:=\-]?\s*'+num+r'\s*(?:mm)?\s*[x×]\s*'+num+r'\s*(?:mm)?\s*[x×]\s*'+num+r'\s*(?:mm)?',line,re.I):
            stock=sorted(measurement(v) for v in match.groups())
            if 0<stock[0]<=100 and stock[1]>=3*stock[0]: record(stock[0],line)
        # OD × wall is a conventional round tube notation, but bare two-number
        # pipe text also could mean OD × length: require OD symbol or wall suffix.
        for match in re.finditer(r'\b(?:round\s+tube|pipe|tube)\s*[:=\-]?\s*([Øø⌀∅]?)\s*'+num+r'\s*(?:mm)?\s*[x×]\s*'+num+r'\s*(?:mm)?\s*(wall|thk\.?|thickness)?',line,re.I):
            symbol,outer,wall,suffix=match.groups()
            od,th=measurement(outer),measurement(wall)
            if (symbol or suffix) and 0<th<od/2: record(th,line)
    # Recover semantic OD/ID dimensions from actual text when a round section
    # is identified but the extractor omitted those two measurements.
    form=' '.join(str(data.get(k) or '') for k in ('description','part_form','manufacturing_category','primary_manufacturing_type'))+' '+str((data.get('engineering_intelligence') or {}).get('part_form') or '')
    if re.search(r'pipe|piping|tube|hollow|bush|sleeve',form+' '+source,re.I) and not re.search(r'rectangular|square|\brhs\b|\bshs\b',form+' '+source,re.I):
        for name,tag in [('OD',r'outer\s+dia(?:meter)?|outside\s+dia(?:meter)?|\bo\.?d\.?\b'),('ID',r'inner\s+dia(?:meter)?|inside\s+dia(?:meter)?|\bi\.?d\.?\b')]:
            matches={}
            for line in source.splitlines():
                for m in re.finditer(r'(?:'+tag+r')\s*[:=]?\s*[Øø⌀∅]?\s*'+num+r'\s*'+unit,line,re.I):
                    v=measurement(m.group(1),m.group(2) or '')
                    if v>0: matches[round(v,6)]=line.strip()[:220]
            if len(matches)==1:
                v,line=next(iter(matches.items()))
                if not any(isinstance(d,dict) and re.fullmatch(r'(?:overall |primary )?(?:outer|outside|external) dia(?:meter)?|O\.?D\.?' if name=='OD' else r'(?:overall |primary )?(?:inner|inside|internal) dia(?:meter)?|I\.?D\.?',str(d.get('label') or '').strip(),re.I) and positive(d.get('value_mm')) for d in data.get('dimensions') or []):
                    data.setdefault('dimensions',[]).append({'label':name,'value_mm':v,'callout':line,'confidence':90})
        if not re.search(r'pipe|piping|tube|hollow|bush|sleeve',form,re.I) and re.search(r'\b(?:pipe|tube)\b',source,re.I):
            # Use an explicit source form without replacing the reviewed classification.
            if not data.get('part_form'): data['part_form']='Round pipe/tube'
    if len(candidates)!=1: return None
    value,callout=next(iter(candidates.items()))
    data['thickness_mm']=value
    data['thickness_basis']='Explicit drawing thickness callout'
    data.setdefault('mandatory_fields',{})['thickness_mm']=True
    data.setdefault('confidence',{})['thickness']=90
    data['dimensions']=[d for d in data.get('dimensions') or [] if not (isinstance(d,dict) and re.search(r'thickness|thk',str(d.get('label') or ''),re.I) and not positive(d.get('value_mm')))]
    if not any(isinstance(d,dict) and re.search(r'thickness|thk',str(d.get('label') or ''),re.I) and abs(positive(d.get('value_mm'))-value)<1e-6 for d in data['dimensions']):
        data['dimensions'].append({'label':'Thickness','value_mm':value,'confidence':90,'callout':callout})
    return value


def recover_cad_thickness(data, metadata):
    """Restore a measured CAD wall/single-plate thickness from the actual source."""
    if positive(data.get('thickness_mm')) or data.get('assembly_parts') or data.get('manufacturing_category')=='Assembly' or int(metadata.get('solid_count') or 1)>1: return None
    wall=metadata.get('wall_thickness') or {}
    value=positive(wall.get('value_mm'))
    basis=str(wall.get('basis') or 'CAD wall geometry; verify')
    if not value and metadata.get('shape_hint')=='plate_like':
        dims=metadata.get('dimensions_mm') or {}
        axes=sorted(positive(dims.get(k)) for k in ('x','y','z'))
        if len(axes)==3 and axes[0]>0 and axes[1]>=3*axes[0]:
            value=axes[0];basis='Estimated flat plate thickness from CAD envelope; confirm'
    if not value: return None
    data['thickness_mm']=round(value,6);data['thickness_basis']=basis
    data.setdefault('mandatory_fields',{})['thickness_mm']=True
    data.setdefault('confidence',{})['thickness']=int(wall.get('confidence') or 65)
    data['dimensions']=[d for d in data.get('dimensions') or [] if not (isinstance(d,dict) and re.search(r'thickness|thk',str(d.get('label') or ''),re.I) and not positive(d.get('value_mm')))]
    if not any(isinstance(d,dict) and re.search(r'thickness|thk',str(d.get('label') or ''),re.I) and abs(positive(d.get('value_mm'))-value)<1e-6 for d in data['dimensions']):
        data['dimensions'].append({'label':'Thickness','value_mm':round(value,6),'source':basis,'confidence':data['confidence']['thickness']})
    return value


def normalize_thickness(data):
    """Use source-supported thickness, never manufacture a value for a solid or unknown drawing."""
    existing = positive(data.get('thickness_mm'))
    if not existing and 'Thickness' in (data.get('conflicting_fields') or []): return None
    if existing:
        return existing
    if data.get('assembly_parts') or data.get('manufacturing_category') == 'Assembly':
        return None
    wall = normalize_wall(data)
    if wall:
        return wall
    form = ' '.join(str(data.get(k) or '') for k in ('part_form','manufacturing_category','description','drawing_type'))
    form += ' ' + str((data.get('engineering_intelligence') or {}).get('part_form') or '')
    dims = data.get('dimensions') or []
    named = {round(positive(d.get('value_mm')),6) for d in dims if isinstance(d,dict) and re.search(r'\b(?:thickness|thk|wall thickness)\b',str(d.get('label') or ''),re.I)} - {0}
    value = next(iter(named)) if len(named)==1 else 0
    basis = 'Thickness-labelled drawing measurement'
    if len(named)>1: return None
    form += ' ' + str((data.get('cad_geometry') or {}).get('shape_hint') or '')
    if not value and re.search(r'plate|sheet|flat|strip|panel|bracket|cover',form,re.I) and not re.search(r'pipe|tube|hollow|assembly|bend|formed|enclosure|angle',form,re.I):
        axes = (data.get('cad_geometry') or {}).get('dimensions_mm') or {}
        values = sorted(positive(axes.get(k)) for k in ('x','y','z'))
        if not all(values):
            groups = []
            for pattern in (r'^(?:overall )?(?:length|x)(?: \(predicted\))?$',r'^(?:overall )?(?:width|y)(?: \(predicted\))?$',r'^(?:overall )?(?:height|depth|z)(?: \(predicted\))?$'):
                vals = {positive(d.get('value_mm')) for d in dims if isinstance(d,dict) and re.fullmatch(pattern,str(d.get('label') or ''),re.I)} - {0}
                if len(vals)==1: groups.append(vals.pop())
            values = sorted(groups)
        if len(values)==3 and 0<values[0]<=50 and values[1]>=values[0]*3:
            value=values[0]; basis='Estimated flat plate thickness from smallest orthogonal envelope axis; confirm'
    if not value: return None
    data['thickness_mm']=value
    data['thickness_basis']=basis
    data.setdefault('mandatory_fields',{})['thickness_mm']=True
    data.setdefault('confidence',{})['thickness']=65 if basis.startswith('Estimated') else 90
    data['dimensions']=[d for d in dims if not (isinstance(d,dict) and re.search(r'thickness|thk',str(d.get('label') or ''),re.I) and not positive(d.get('value_mm')))]
    if not any(isinstance(d,dict) and re.search(r'thickness|thk',str(d.get('label') or ''),re.I) and positive(d.get('value_mm')) for d in data['dimensions']):
        data['dimensions'].append({'label':'Thickness','value_mm':value,'source':basis,'confidence':data['confidence']['thickness']})
    return value
