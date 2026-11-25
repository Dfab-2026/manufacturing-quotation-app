"""Budgetary customer quotation PDF, isolated from calculations and save/history flows.

This module renders the reviewed cost sheet; it never invents manufacturing rates.
The originating drawing and relevant technical evidence are always retained.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from io import BytesIO
from math import isfinite
from pathlib import Path
import base64
import binascii
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NAVY = colors.HexColor('#142B42')
TEAL = colors.HexColor('#167D8D')
SLATE = colors.HexColor('#596C80')
PALE = colors.HexColor('#EEF5F8')
RULE = colors.HexColor('#DCE7EC')


def _paragraph(value: object, style: ParagraphStyle, max_chars: int = 900) -> Paragraph:
    return Paragraph(escape(str(value if value is not None else '')[:max_chars]).replace('\n', '<br/>'), style)


def _numeric(value: object, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if isfinite(number) else default


def _preview(value: str) -> Image | None:
    """Accept only small raster data URLs; never load user-supplied remote URLs."""
    if not value or len(value) > 2_900_000:
        return None
    m = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)', value)
    if not m:
        return None
    try:
        raw = base64.b64decode(m.group(2), validate=True)
        if not raw or len(raw) > 2 * 1024 * 1024:
            return None
        # Require genuine PNG/JPEG file signatures.
        if m.group(1) == 'png' and not raw.startswith(b'\x89PNG\r\n\x1a\n'):
            return None
        if m.group(1) == 'jpeg' and not raw.startswith(b'\xff\xd8\xff'):
            return None
        from reportlab.lib.utils import ImageReader
        reader = ImageReader(BytesIO(raw))
        w, h = reader.getSize()
        if not (0 < w <= 4096 and 0 < h <= 4096):
            return None
        ratio = min(85 * mm / w, 58 * mm / h)
        return Image(BytesIO(raw), width=w * ratio, height=h * ratio)
    except (ValueError, OSError, binascii.Error):
        return None


def _engineering_lines(engineering: dict, drawing: dict) -> list[str]:
    cad = engineering.get('cad_geometry') or {}
    dims = cad.get('dimensions_mm') or {}
    result: list[str] = []
    if all(_numeric(dims.get(axis)) > 0 for axis in ('x', 'y', 'z')):
        result.append('Overall extents: ' + ' × '.join(f'{_numeric(dims[axis]):g}' for axis in ('x', 'y', 'z')) + ' mm')
    patterns = (cad.get('step_metadata') or {}).get('bolt_circle_patterns') or []
    for pattern in patterns[:2]:
        if not isinstance(pattern,dict):
            continue
        dia, pcd = _numeric(pattern.get('diameter_mm')), _numeric(pattern.get('pcd_mm'))
        count = max(1,int(_numeric(pattern.get('quantity'), 1)))
        if dia > 0 and pcd > 0:
            result.append(f'Bolt pattern: {count} × Ø{dia:g} mm on PCD Ø{pcd:g} mm (review)')
    volume = _numeric(cad.get('volume_mm3'))
    if volume > 0:
        result.append(f'CAD volume: {volume:,.1f} mm³')
    count = int(_numeric(cad.get('part_count'), 0))
    if count > 0:
        result.append(f'Solid bodies: {count}')
    if _numeric(drawing.get('weight_kg')) > 0:
        source = str(engineering.get('weight_source') or '').lower()
        suffix = ' (calculated from geometry and assumed density)' if 'cad' in source else ''
        result.append(f'Net weight: {_numeric(drawing["weight_kg"]):.3f} kg{suffix}')
    if _numeric(drawing.get('thickness_mm')) > 0:
        result.append(f'Wall/plate thickness: {_numeric(drawing["thickness_mm"]):g} mm (verify applicable feature)')
    return result[:7]


def make_quotation_pdf(*, customer: str, drawing: dict, rows: list[dict],
                       summary: dict, engineering: dict | None = None,
                       preview_image: str = '', gst_pct: float = 18.0) -> bytes:
    """Render a two-section customer quotation without changing the existing cost model.

    GST is explicitly provisional because the applicable classification is not
    established by CAD geometry.  The rate is supplied by the caller.
    """
    engineering = engineering or {}
    gst_pct = _numeric(gst_pct)
    if not 0 <= gst_pct <= 100:
        raise ValueError('GST percentage must be between 0 and 100.')
    qty = max(1, int(_numeric(drawing.get('quantity'), 1)))
    sale = max(0, _numeric(summary.get('selling_price')))
    unit = sale / qty
    gst = round(sale * gst_pct / 100, 2)
    grand = round(sale + gst, 2)
    date = datetime.now(timezone.utc).strftime('%d %b %Y')
    ref_code = re.sub('[^A-Za-z0-9-]+', '-', str(drawing.get('drawing_no') or 'DRAWING'))[:36].strip('-')
    reference = f'EST-{ref_code}-{datetime.now(timezone.utc):%Y%m%d}'
    output = BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, rightMargin=18 * mm,
                            leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=20 * mm)
    styles = {
        'title': ParagraphStyle('QTitle', fontName='Helvetica-Bold', fontSize=16, leading=20, textColor=NAVY, spaceAfter=6),
        'subtitle': ParagraphStyle('QSubtitle', fontName='Helvetica', fontSize=9, leading=13, textColor=SLATE),
        'body': ParagraphStyle('QBody', fontName='Helvetica', fontSize=8.3, leading=12, textColor=NAVY),
        'small': ParagraphStyle('QSmall', fontName='Helvetica', fontSize=7.4, leading=10.5, textColor=SLATE),
        'label': ParagraphStyle('QLabel', fontName='Helvetica-Bold', fontSize=7.7, leading=11, textColor=NAVY),
        'white': ParagraphStyle('QWhite', fontName='Helvetica-Bold', fontSize=8, leading=11, textColor=colors.white),
        'section': ParagraphStyle('QSection', fontName='Helvetica-Bold', fontSize=9.5, leading=13, textColor=NAVY, spaceBefore=10, spaceAfter=6),
        'warn': ParagraphStyle('QWarn', fontName='Helvetica-Bold', fontSize=7.7, leading=11, textColor=colors.HexColor('#A56012')),
    }
    P = lambda value, style='body', limit=900: _paragraph(value, styles[style], limit)
    content = [P('BUDGETARY MANUFACTURING QUOTATION', 'title'),
               P(drawing.get('description') or drawing.get('drawing_no') or 'Manufactured component', 'subtitle'),
               Spacer(1, 10)]
    meta = [
        [P('Quotation ref.', 'small'), P(reference), P('Date', 'small'), P(date)],
        [P('Customer', 'small'), P(customer or 'To be confirmed'), P('Quantity', 'small'), P(f'{qty} No.')],
        [P('Drawing no.', 'small'), P(drawing.get('drawing_no') or 'Unspecified'), P('Revision', 'small'), P(drawing.get('revision') or 'Unspecified')],
        [P('Material', 'small'), P(drawing.get('material') or 'Review required'), P('Status', 'small'), P('Budgetary / review')],
    ]
    tbl = Table(meta, colWidths=[29*mm,69*mm,29*mm,47*mm], hAlign='LEFT')
    tbl.setStyle(TableStyle([('BACKGROUND', (0,0),(-1,-1),PALE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                             ('LEFTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),7),
                             ('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-2),.3,RULE)]))
    content.extend([tbl, Spacer(1, 9)])
    lines = _engineering_lines(engineering, drawing)
    raster = _preview(preview_image)
    if lines or raster:
        geo = [P('CAD / DRAWING DETAILS', 'section')]
        for line in lines:
            geo.append(P(line,'body'))
            geo.append(Spacer(1,2))
        if not lines:
            geo.append(P('Source drawing/model preview; engineering values require review.', 'small'))
        if raster:
            cell = Table([[raster, geo]], colWidths=[87*mm, 87*mm], hAlign='LEFT')
            cell.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'), ('BOX',(0,0),(-1,-1), .5,RULE),
                                      ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),
                                      ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
            content.append(cell)
        else:
            content.extend(geo)
    content.append(P('PRICE OFFER (INR)', 'section'))
    item_table = Table([
        [P('DESCRIPTION','white'),P('QTY','white'),P('UNIT PRICE','white'),P('TOTAL','white')],
        [P(drawing.get('description') or 'Custom fabricated component'), P(str(qty)),P(f'{unit:,.2f}'),P(f'{sale:,.2f}')],
    ],colWidths=[91*mm,17*mm,33*mm,33*mm], hAlign='LEFT')
    item_table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('VALIGN',(0,0),(-1,-1),'TOP'),
                                    ('BACKGROUND',(0,1),(-1,1),PALE),('LEFTPADDING',(0,0),(-1,-1),7),
                                    ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
                                    ('LINEBELOW',(0,-1),(-1,-1),.5,RULE)]))
    content.extend([item_table, Spacer(1,10)])
    sums = [
        [P('Manufacturing selling price'), P(f'INR {sale:,.2f}','label')],
        [P(f'GST ({gst_pct:g}% provisional; verify HSN and applicability)'), P(f'INR {gst:,.2f}','label')],
    ]
    st = Table(sums, colWidths=[126*mm,48*mm],hAlign='RIGHT')
    st.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('TOPPADDING',(0,0),(-1,-1),8),
                            ('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.35,RULE),
                            ('ALIGN',(1,0),(1,-1),'RIGHT')]))
    total = Table([[P('TOTAL ESTIMATE INCLUDING GST','white'),P(f'INR {grand:,.2f}','white')]],colWidths=[118*mm,56*mm])
    total.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),TEAL),('TOPPADDING',(0,0),(-1,-1),11),
                               ('BOTTOMPADDING',(0,0),(-1,-1),11),('ALIGN',(1,0),(1,0),'RIGHT')]))
    content.extend([st,Spacer(1,4),total,Spacer(1,10),
                    P('This is an engineering estimate, not a binding supplier offer. Rates, technical requirements, GST and lead time require confirmation before issue.', 'warn')])

    content.append(PageBreak())
    content.append(P('MANUFACTURING & ENGINEERING BASIS', 'section'))
    methods = engineering.get('manufacturing_processes') or []
    if not methods:
        methods = engineering.get('process_route') or []
    seen = set()
    for op in methods[:15]:
        name = str(op.get('process') or op.get('name') or '') if isinstance(op, dict) else str(op)
        if name and name.lower() not in seen:
            seen.add(name.lower())
            content.append(P('- ' + name[:180]))
    if not seen:
        content.append(P('Process route pending confirmation against approved drawing.','small'))
    content.append(Spacer(1,6))
    features = ((engineering.get('cad_geometry') or {}).get('step_metadata') or {}).get('hole_features') or []
    if features:
        content.append(P('CAD GEOMETRIC FEATURES (REVIEW REQUIRED)', 'section'))
        for feature in features[:8]:
            if not isinstance(feature, dict):
                continue
            dia = _numeric(feature.get('diameter_mm'))
            count = max(1, int(_numeric(feature.get('quantity'), 1)))
            if dia > 0:
                content.append(P(f'- {count} cylindrical bore/feature(s), measured diameter {dia:g} mm; function to verify'))
        content.append(Spacer(1,5))
    applicable = [r for r in rows if _numeric(r.get('costingQty')) > 0 and str(r.get('category') or '').upper() in ('MATERIAL', 'PROCESS', 'LABOUR', 'OTHER')]
    if applicable:
        content.append(P('INCLUDED COSTING OPERATIONS', 'section'))
        for row in applicable[:12]:
            content.append(P(f'- {str(row.get("item") or "Process")[:120]}: {_numeric(row.get("costingQty")):g} {str(row.get("unit") or "unit")[:20]} (rate from cost sheet)'))
        content.append(Spacer(1,5))
    content.append(P('COSTING BASIS AND REVIEW ITEMS', 'section'))
    unresolved = [row for row in rows if _numeric(row.get('costingQty')) > 0 and _numeric(row.get('rate')) <= 0]
    if unresolved:
        content.append(P(f'{len(unresolved)} unpriced process/material rows need supplier or Rate Master confirmation.', 'warn'))
        for row in unresolved[:6]:
            content.append(P('- Unpriced: ' + str(row.get('item') or 'Process')[:130]))
    for note in (engineering.get('missing_or_uncertain') or [])[:8]:
        content.append(P('- ' + str(note)[:260]))
    if not unresolved and not engineering.get('missing_or_uncertain'):
        content.append(P('Engineering data and pricing must still be reviewed against final manufacturing drawings.','small'))
    content.append(P('PROVISIONAL COMMERCIAL TERMS','section'))
    terms = [
        ('Delivery', 'To be confirmed after technical approval and supplier capacity review'),
        ('Validity', 'To be confirmed by the issuing supplier'),
        ('Payment', 'To be agreed'),
        ('Supply basis', 'Finished component as per approved manufacturing drawing; freight and special tests excluded unless agreed'),
        ('Technical release', 'Confirm grade/certificates, tolerances, weld/test requirements, and standards before manufacture'),
    ]
    tt=Table([[P(k,'label'),P(v)] for k,v in terms], colWidths=[38*mm,136*mm])
    tt.setStyle(TableStyle([('ROWBACKGROUNDS',(0,0),(-1,-1),[PALE,colors.white]),
                            ('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),7),
                            ('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.3,RULE)]))
    content.append(tt)
    def footer(canvas, d):
        canvas.setStrokeColor(RULE)
        canvas.line(18*mm, 15*mm, 192*mm, 15*mm)
        canvas.setFont('Helvetica',7)
        canvas.setFillColor(SLATE)
        canvas.drawString(18*mm,11*mm,'ENGINEERING BUDGET ESTIMATE | Subject to validation')
        canvas.drawRightString(192*mm,11*mm,f'Page {d.page}')
    doc.build(content,onFirstPage=footer,onLaterPages=footer)
    return output.getvalue()
