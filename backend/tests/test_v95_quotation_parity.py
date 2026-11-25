"""Production quotation parity checks (numeric outputs are taken from cost sheet)."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.main import app


QUOTE = {
    'customer': 'Example Buyer',
    'drawing': {
        'drawing_no': 'PID#15948', 'revision': 'R2.01',
        'description': 'SS316 Flange Adaptor - DN50 PN16 to 3-inch Tri-Clamp',
        'material': 'AISI 316 (review required)', 'thickness_mm': 0,
        'weight_kg': 3.516, 'quantity': 1,
    },
    'rows': [
        {'id': 'steel', 'category': 'MATERIAL', 'item': 'SS316 raw stock', 'drawingQty': '1',
         'costingQty': 2, 'unit': 'kg', 'rate': 1500, 'cost': 3000,
         'confidence': 'Estimated', 'rateSource': 'Rate Master'},
        {'id': 'weld', 'category': 'PROCESS', 'item': 'TIG Welding', 'drawingQty': '1',
         'costingQty': 2, 'unit': 'hr', 'rate': 1000, 'cost': 2000,
         'confidence': 'Estimated', 'rateSource': 'Rate Master'},
    ],
    'summary': {
        'direct_cost': 5000, 'material_wastage': 0, 'overhead': 1000,
        'manufacturing_cost': 6000, 'markup': 1200, 'selling_price': 7200,
        'material_wastage_pct': 0, 'overhead_pct': 20, 'markup_pct': 20,
    },
    'engineering': {
        'cad_geometry': {'dimensions_mm': {'x': 165, 'y': 188, 'z': 165},
                         'volume_mm3': 440614.211, 'part_count': 2},
        'weight_source': 'cad_solid_volume',
        'manufacturing_processes': [{'process': 'CNC Turning'}, {'process': 'TIG Welding'}],
        'missing_or_uncertain': ['Confirm material grade and test requirements'],
    },
}


def test_customer_pdf_contains_correct_subtotal_gst_and_cad_evidence():
    response = TestClient(app).post('/api/export/pdf', json=QUOTE)
    assert response.status_code == 200, response.text
    reader = PdfReader(BytesIO(response.content))
    assert len(reader.pages) == 2
    content = '\n'.join(page.extract_text() for page in reader.pages)
    for expected in ['BUDGETARY MANUFACTURING QUOTATION', 'PID#15948', 'R2.01',
                     '165 × 188 × 165', '7,200.00', '1,296.00', '8,496.00',
                     'Confirm material grade', 'TIG Welding']:
        assert expected in content
    # Price 17,416.80 from the reference quote must not be hard-coded.
    assert '17,416.80' not in content


def test_client_cannot_set_invalid_gst():
    bad = {**QUOTE, 'gst_pct': 120}
    assert TestClient(app).post('/api/export/pdf', json=bad).status_code == 422


def test_excel_recalculates_costs_without_formula_injection():
    response = TestClient(app).post('/api/export/excel', json=QUOTE)
    assert response.status_code == 200, response.text
    with ZipFile(BytesIO(response.content)) as archive:
        data = archive.read('xl/worksheets/sheet1.xml')
    root = ET.fromstring(data)
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    cells = {cell.attrib['r']: cell for cell in root.findall('.//s:c', ns)}
    def formula(coord):
        f = cells[coord].find('s:f', ns)
        return '' if f is None else f.text or ''
    assert 'MAX(0,D13)*MAX(0,F13)' in formula('J13')
    assert 'SUM(J13:J14)' in formula('J17')
    assert 'SUMIF' in formula('J18')
    assert 'J' in formula('J23') and '/' in formula('J23')
    assert 'J' in formula('J24')
    assert all(formula(f'J{i}') for i in range(13,15))


def test_step_bbox_from_customer_file_if_provided(monkeypatch):
    import os
    path = os.environ.get('DFAB_TEST_STEP_FILE')
    if not path:
        pytest.skip('Set DFAB_TEST_STEP_FILE to run customer STEP acceptance check')
    from app.cad_brep import analyze_step_brep
    file = Path(path)
    geometry = analyze_step_brep(file.read_bytes(), file.name)
    assert geometry['dimensions_mm']['x'] == pytest.approx(165.0, abs=.01)
    assert geometry['dimensions_mm']['y'] == pytest.approx(188.0, abs=.01)
    assert geometry['dimensions_mm']['z'] == pytest.approx(165.0, abs=.01)
    assert geometry['solid_count'] == 2
    assert len(geometry['solid_components']) == 2
    # Individual STEP solids overlap slightly (two manufactured bodies before
    # union); their component volumes must not replace the net assembly volume.
    assert sum(item['volume_mm3'] for item in geometry['solid_components']) >= geometry['volume_mm3']
    assert geometry['volume_mm3'] == pytest.approx(440614.21, rel=1e-4)
    assert any(
        pattern['diameter_mm'] == pytest.approx(18, abs=.01)
        and pattern['pcd_mm'] == pytest.approx(125, abs=.1)
        and pattern['quantity'] == 4
        for pattern in geometry['bolt_circle_patterns']
    ), geometry['bolt_circle_patterns']


def test_ss316_density_uses_confirmed_grade_not_generic_family():
    from app.main import Drawing, _internal_density
    drawing = Drawing(drawing_no='X', revision='', description='', material='Stainless Steel AISI 316',
                      thickness_mm=0, weight_kg=0, quantity=1)
    ai = {'material': {'family': 'Stainless Steel', 'grade': 'AISI 316'}}
    assert _internal_density(ai, drawing) == pytest.approx(7.98e-6)


def test_cad_filename_identity_is_reviewable_not_authoritative():
    from app.main import CadAnalysisReq, analyze_cad
    value = CadAnalysisReq(
        filename='[PID#15948] 316SS Flange Adaptor - R2.01 - 2025-06-05.STEP',
        file_hash='v95-file', format='STEP', parser_status='parsed',
        root_name='Flange Adaptor', part_count=2, mesh_count=2, triangle_count=120,
        dimensions_mm={'x':165,'y':188,'z':165}, surface_area_mm2=100000,
        volume_mm3=440614.21, component_names=[], shape_hint='rotational_like',
        step_metadata={'solid_components': [
            {'volume_mm3':366755.181,'dimensions_mm':{'x':165,'y':20,'z':165}},
            {'volume_mm3':73919.395,'dimensions_mm':{'x':103.2376,'y':168,'z':100.3008}},
        ]}
    )
    result = analyze_cad(value)
    assert result['drawing'].drawing_no == 'PID#15948'
    assert result['drawing'].revision == 'R2.01'
    assert len(result['ai_raw']['assembly_parts']) == 2
    assert any('filename' in note.lower() for note in result['ai_raw']['missing_or_uncertain'])
