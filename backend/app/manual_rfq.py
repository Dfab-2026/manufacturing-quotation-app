"""Company quotation reference: explicit rates, dimensional units and exact-ID retrieval.
Historical totals are not trusted as labels for geometric or costing predictions.
"""
import json
import math
from functools import lru_cache
from pathlib import Path

SOURCE = 'Manual quotation template · '
# id: (old price, old unit, observed price, compatible/new unit, evidence)
UPDATES = {
    'MAT-GI-DX51': (95, 'kg', 80, 'kg', 'RM!S2:S59 · HDG steel'),
    'PROC-BEND': (350, 'job', 10, 'bend', 'Process Cost!W2:W59'),
    'PROC-GRIND': (350, 'job', 25, 'operation', 'Process Cost!O2:O59'),
    'PROC-MILL': (800, 'hr', 100, 'hr', 'Process Cost!Z2:Z59'),
    'PROC-TURN': (650, 'hr', 300, 'hr', 'Process Cost!AC2:AC59'),
    'PROC-BORE': (350, 'job', 300, 'hr', 'Process Cost!AF · drilling, typical rate'),
    'PROC-THREAD': (250, 'job', 300, 'hr', 'Process Cost!AI2:AI59'),
    'PROC-COAT': (300, 'm2', 50, 'kg', 'Finishing Cost!L · typical powder coating'),
    'COMM-MARKUP': (15, '%', 40, '%', 'DFAB-Cost!L2 · 40% of subtotal'),
}
ADDITIONS = [
 ('MAT-SS-MANUAL','MATERIAL','Stainless Steel (grade unspecified)','Unspecified sheet','kg',350,'RM!S36:S37; confirm grade'),
 ('MAT-AL-MANUAL','MATERIAL','Aluminium Al/Mg Sheet','AL/MG','kg',650,'RM!S43; confirm alloy'),
 ('PROC-CLINCH','PROCESS','Manual Clinching','','operation',25,'Process Cost!L · typical rate; alternatives exist'),
 ('PROC-LASER-MANUAL','PROCESS','Laser Cutting (thickness & piercing)','','m·mm',12,'Process Cost!T/U · length in metres × thickness; piercing factor 10%; 13 also observed'),
 ('PROC-WELD-MANUAL','PROCESS','Welding (manual template)','','inch',18,'Process Cost!AM · most common; 20 and 35 also observed'),
 ('PROC-WELD-MANUAL-20','PROCESS','Welding alternative 20','','inch',20,'Process Cost!AM · alternative, select manually'),
 ('PROC-WELD-MANUAL-35','PROCESS','Welding alternative 35','','inch',35,'Process Cost!AM · alternative, select manually'),
 ('OTHER-STRETCH','OTHER','Stretch Wrap','','piece',10,'Packaging Cost!N/O'),
 ('MAT-CRS-MANUAL','MATERIAL','Cold Rolled Steel Sheet','Grade unspecified','kg',80,'RM!S44; confirm grade'),
 ('PROC-CLINCH-300','PROCESS','Manual Clinching alternative 300','','operation',300,'Process Cost!L; exceptional direct historical rate; select manually'),
 ('PROC-LASER-MANUAL-13','PROCESS','Laser Cutting alternative 13','','m·mm',13,'Process Cost!T59; select manually'),
 ('PROC-BORE-301','PROCESS','Drilling alternative 301','','hr',301,'Process Cost!AF58; select manually'),
 ('PROC-BORE-302','PROCESS','Drilling alternative 302','','hr',302,'Process Cost!AF59; select manually'),
 ('PROC-PAINT-MANUAL','PROCESS','Painting (manual template)','','kg',50,'Finishing Cost!N37; confirm actual finish specification'),
 ('PROC-BUFF-MANUAL','PROCESS','Buffing (manual template)','','kg',1,'Finishing Cost!Q; historical literal; confirm before release'),
 ('PROC-BUFF-MANUAL-300','PROCESS','Buffing alternative 300','','kg',300,'Finishing Cost!Q; historical literal; select manually'),
]

def apply_template_defaults(rows):
    for r in rows:
        if r['id'] in UPDATES:
            _,_,price,unit,evidence = UPDATES[r['id']]
            r.update(price=price,unit=unit,notes=SOURCE+evidence)
    return rows

def upgrade_starter(row):
    rule=UPDATES.get(row.get('id'))
    if not rule:return False
    old,unit,price,new_unit,evidence=rule
    if row.get('price') != old or row.get('unit') != unit:return False
    notes=str(row.get('notes') or '')
    if not notes.startswith(('Starter rate','Starter hourly','Bending/forming rate','Finishing rate','Coating rate','Applied to manufacturing cost')):return False
    row.update(price=price,unit=new_unit,notes=SOURCE+evidence)
    return True

def positive(value):
    try:
        x=float(value)
        return x if math.isfinite(x) and x>0 else 0.0
    except (TypeError,ValueError):return 0.0

def feature_count(items):
    return sum(positive(x.get('quantity',1)) for x in (items or []) if isinstance(x,dict))

def laser_units(length_mm, thickness_mm, piercings, quantity):
    l,t,q=map(positive,(length_mm,thickness_mm,quantity))
    if not all((l,t,q)):return 0.0
    return ((l/1000)+0.1*positive(piercings))*t*q

@lru_cache(maxsize=1)
def reference():
    path=Path(__file__).resolve().parents[1]/'private_reference'/'manual_quotation.json'
    try:return json.loads(path.read_text(encoding='utf-8')).get('by_drawing',{})
    except (OSError,ValueError):return {}

def historical_note(drawing_no):
    data=reference().get(str(drawing_no or '').strip().upper())
    if not data:return None
    note = 'Manual RFQ reference: exact drawing number found. Prior revision, dimensions and rates require confirmation; historical totals are not copied.'
    rows = data.get('RM', [])
    if len(rows)==1:
        v=rows[0]['values']
        detail = ', '.join(f'{label} {v[col]} mm' for col,label in [('O','blank length'),('P','blank width'),('Q','thickness')] if positive(v.get(col)))
        if detail: note += ' Historical RM: '+detail+'.'
    rows = data.get('Process Cost', [])
    if len(rows)==1:
        v=rows[0]['values']
        detail = ', '.join(f'{label} {v[col]}' for col,label in [('K','clinches'),('N','grinding operations'),('R','piercings'),('V','bends'),('Y','milling hours'),('AB','turning hours'),('AE','drilling hours'),('AH','tapping hours')] if positive(v.get(col)))
        if detail: note += ' Historical process inputs: '+detail+'.'
    return note
