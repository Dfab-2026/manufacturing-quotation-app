from app.manual_rfq import laser_units, upgrade_starter, historical_note
from app.main import default_rate_items, _estimated_qty_for_process, Drawing

def test_manual_rates_and_no_override():
    rates={r['id']:r for r in default_rate_items()}
    assert (rates['PROC-BEND']['price'],rates['PROC-BEND']['unit'])==(10,'bend')
    assert rates['MAT-GI-DX51']['price']==80
    assert rates['PROC-COAT']['unit']=='kg'
    custom={'id':'PROC-BEND','price':77,'unit':'job','notes':'Engineer approved'}
    assert not upgrade_starter(custom)
    starter={'id':'PROC-BEND','price':350,'unit':'job','notes':'Bending/forming rate'}
    assert upgrade_starter(starter) and starter['unit']=='bend'

def test_laser_quantity_and_bends():
    assert abs(laser_units(1320,2,95,3)*12-779.04)<1e-8
    assert laser_units(0,2,95,3)==0
    d=Drawing(drawing_no='',revision='',description='',material='',thickness_mm=2,weight_kg=1,quantity=3)
    assert _estimated_qty_for_process('PROC-BEND','bend',{'bends':[{'quantity':4}]},d)==12

def test_exact_history_no_fuzzy():
    assert historical_note('3AUA0000031989')
    assert historical_note('3AUA000003198') is None
