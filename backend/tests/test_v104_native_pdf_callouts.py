import pymupdf

from app.main import _extract_pdf_native_callout_text, _local_fastapi_engineering_extract


def _pdf_with_rows(rows):
    doc = pymupdf.open()
    page = doc.new_page(width=842, height=595)
    y = 70
    for left, right in rows:
        page.insert_text((60, y), left, fontsize=10)
        page.insert_text((250, y), right, fontsize=10)
        y += 28
    data = doc.tobytes()
    doc.close()
    return data


def test_native_pdf_rejoins_split_engineering_cells_without_ocr():
    pdf = _pdf_with_rows([
        ("DRAWING NO", "PID#15948"),
        ("REVISION", "R2.01"),
        ("MATERIAL", "SS 316"),
        ("LENGTH", "188 mm"),
        ("WIDTH", "165 mm"),
        ("THICKNESS", "20 mm"),
        ("WEIGHT", "3.52 kg"),
        ("HOLES", "4 X Ø18 THRU PCD 125"),
    ])

    callouts = _extract_pdf_native_callout_text(pdf)
    assert "LENGTH 188 mm" in callouts
    assert "WIDTH 165 mm" in callouts
    assert "THICKNESS 20 mm" in callouts

    raw, drawing, rows, warnings, preview = _local_fastapi_engineering_extract(
        pdf, "[PID#15948] 316SS Flange - R2.01.pdf", False
    )
    assert raw["length_mm"] == 188
    assert raw["width_mm"] == 165
    assert raw["thickness_mm"] == 20
    assert raw["material"]["grade"] == "AISI 316"
    assert drawing.weight_kg == 3.52
    assert any(h["quantity"] == 4 and h["diameter_mm"] == 18 for h in raw["holes"])
    assert "LENGTH 188 mm" in preview
    assert raw["extraction_meta"]["pipeline_version"].endswith("v24-native-pdf-callouts")


def test_native_pdf_does_not_promote_sheet_size_to_part_dimensions():
    pdf = _pdf_with_rows([
        ("SHEET SIZE", "420 x 297 mm"),
        ("SCALE", "1:2"),
        ("REVISION", "R1"),
        ("LENGTH", "120 mm"),
        ("WIDTH", "55 mm"),
        ("THICKNESS", "3 mm"),
        ("MATERIAL", "SS304"),
    ])
    raw, _drawing, _rows, _warnings, _preview = _local_fastapi_engineering_extract(pdf, "part.pdf", False)
    assert raw["length_mm"] == 120
    assert raw["width_mm"] == 55
    assert raw["thickness_mm"] == 3
    values = {float(d["value_mm"]) for d in raw["dimensions"] if d.get("value_mm")}
    assert 420 not in values
    assert 297 not in values
