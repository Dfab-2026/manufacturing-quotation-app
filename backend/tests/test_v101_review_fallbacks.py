from app.main import _resolve_overall_axes_from_dimensions


def test_flange_outer_diameter_becomes_xy_envelope_only_from_explicit_dimension():
    dims = [
        {"label": "Diameter", "value_mm": 165.0, "quantity": 1, "confidence": 92, "callout": "Ø165"},
        {"label": "Diameter", "value_mm": 18.0, "quantity": 4, "confidence": 94, "callout": "4X Ø18 THRU PCD 125"},
    ]
    length, width, notes = _resolve_overall_axes_from_dimensions(dims, {}, set(), "316SS FLANGE ADAPTOR")
    assert length == 165.0
    assert width == 165.0
    assert any("outer diameter" in note.lower() for note in notes)


def test_generic_high_confidence_linear_callouts_fill_missing_envelope():
    dims = [
        {"label": "Linear Dimension", "value_mm": 188.0, "quantity": 1, "confidence": 90, "callout": "188 mm"},
        {"label": "Linear Dimension", "value_mm": 165.0, "quantity": 1, "confidence": 90, "callout": "165 mm"},
        {"label": "Linear Dimension", "value_mm": 18.0, "quantity": 4, "confidence": 95, "callout": "4X 18 THRU"},
    ]
    length, width, notes = _resolve_overall_axes_from_dimensions(dims, {}, set(), "MACHINED BRACKET")
    assert (length, width) == (188.0, 165.0)
    assert notes


def test_feature_dimensions_are_not_promoted_to_overall_axes():
    dims = [
        {"label": "Linear Dimension", "value_mm": 125.0, "quantity": 1, "confidence": 95, "callout": "PCD 125"},
        {"label": "Linear Dimension", "value_mm": 18.0, "quantity": 1, "confidence": 95, "callout": "HOLE 18 THRU"},
    ]
    length, width, notes = _resolve_overall_axes_from_dimensions(dims, {}, set(), "BRACKET")
    assert length is None
    assert width is None
    assert notes == []
