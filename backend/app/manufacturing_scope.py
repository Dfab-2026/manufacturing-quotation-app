"""Conservative procurement and scope identification from extracted evidence."""
import re

STANDARD = re.compile(r'\b(?:weld[ -]neck flange|slip[ -]on flange|blind flange|socket[ -]weld flange|threaded flange|(?:asme|ansi|din|en)\s*[\w. -]{0,20}flange|(?:45|90|180)\s*(?:°|deg(?:ree)?)?\s*elbow|elbow|tee|reducer|coupling|union|nipple|pipe cap|bolt|nut|washer|screw|stud|rivet|bearing|circlip|gasket|ball valve|gate valve|check valve|butterfly valve)\b', re.I)
CUSTOM = re.compile(r'\b(?:custom|machined from|fabricate|manufacture|nonstandard|non-standard)\b', re.I)

def standard_component(text):
    return bool(STANDARD.search(str(text or '')) and not CUSTOM.search(str(text or '')))

def scope_from_notes(data):
    text = ' '.join(str(n) for n in data.get('notes') or []).lower()
    supplied = re.search(r'customer[ -]supplied|free[ -]issue|supplied by (?:the )?customer', text)
    if supplied and re.search(r'\bweld(?:ing)?\s+only\b|\bonly\s+weld(?:ing)?\b', text):
        return 'Welding only'
    if supplied and re.search(r'\b(?:raw material|material|stock)\b', text):
        return 'Customer-supplied raw material'
    if supplied and re.search(r'\b(?:parts|components)\b', text):
        return 'Customer-supplied components'
    return 'Complete manufacturing'

def manufacturing_category(data, intelligence):
    form = intelligence.get('part_form', '')
    primary = intelligence.get('primary_manufacturing_type', '')
    desc = str(data.get('description') or '')
    if form == 'Assembly': return 'Assembly'
    if standard_component(desc) and re.search(r'\b(?:standard|purchased|off.the.shelf|asme|ansi|din)\b', desc, re.I): return 'Standard Components'
    if form == 'Tube / Pipe' or primary == 'Tube / Pipe Fabrication': return 'Piping'
    if re.search(r'\b(?:pressure vessel|tank)\b', desc, re.I): return 'Pressure Vessel & Tank'
    if form == 'Frame': return 'Structural Fabrication'
    if form in ('Sheet', 'Enclosure / Cover') or primary == 'Sheet-Metal Fabrication' or data.get('bends'): return 'Sheet Metal'
    if form == 'Plate': return 'Plate Fabrication'
    if primary in ('Casting', 'Forging', 'Extrusion', 'Additive Manufacturing'): return primary
    if form == 'Shaft / Cylindrical' or primary == 'CNC Turning': return 'Turning'
    if primary in ('CNC Milling', 'General Machining'): return 'CNC Machining'
    return 'Review Required'
