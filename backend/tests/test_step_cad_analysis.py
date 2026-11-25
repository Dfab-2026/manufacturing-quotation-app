from app.main import CadAnalysisReq, analyze_cad


def test_step_analysis_maps_geometry_material_and_features():
    result = analyze_cad(CadAnalysisReq(
        filename="bracket.step",
        file_hash="abc123",
        format="STEP",
        parser_status="parsed",
        root_name="Bracket",
        part_count=1,
        mesh_count=1,
        triangle_count=1200,
        dimensions_mm={"x": 100.0, "y": 60.0, "z": 5.0},
        surface_area_mm2=13000.0,
        volume_mm3=28000.0,
        component_names=[],
        shape_hint="plate_like",
        step_metadata={
            "schema": "AP214",
            "product_names": ["BRACKET-01"],
            "material_text": "AISI 304",
            "entity_counts": {
                "advanced_faces": 18,
                "cylindrical_surfaces": 4,
                "conical_surfaces": 2,
            },
            "cylindrical_diameters_mm": [10.0, 10.0, 100.0],
            "hole_features": [{"type": "Hole", "diameter_mm": 10.0, "quantity": 2, "confidence": 88}],
            "thread_labels": ["M6"],
        },
    ))

    ai = result["ai_raw"]
    assert ai["material"]["family"] == "Stainless Steel"
    assert ai["material"]["grade"] == "AISI 304"
    assert ai["thickness_mm"] == 5.0
    assert ai["length_mm"] == 100.0
    assert ai["width_mm"] == 60.0
    assert ai["weight_kg"] > 0
    assert ai["holes"]
    assert ai["holes"][0]["review_required"] is True
    assert ai["threads"][0]["thread"] == "M6"
    assert ai["chamfers"]
    assert ai["cad_geometry"]["step_metadata"]["schema"] == "AP214"


def test_step_analysis_does_not_invent_material_when_absent():
    result = analyze_cad(CadAnalysisReq(
        filename="unknown.step",
        file_hash="def456",
        format="STEP",
        parser_status="parsed",
        root_name="Unknown",
        part_count=1,
        mesh_count=1,
        triangle_count=12,
        dimensions_mm={"x": 20.0, "y": 20.0, "z": 20.0},
        surface_area_mm2=2400.0,
        volume_mm3=8000.0,
        component_names=[],
        shape_hint="prismatic_like",
        step_metadata={"entity_counts": {"advanced_faces": 6}},
    ))

    ai = result["ai_raw"]
    assert ai["material"]["family"] == ""
    assert ai["weight_kg"] is None
    assert any("Material / grade" in item for item in ai["missing_or_uncertain"])


def test_step_api_response_is_serializable_and_keeps_pdf_shape():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    response = client.post("/api/analyze-cad", json={
        "filename": "plate.step",
        "file_hash": "route123",
        "format": "STEP",
        "parser_status": "parsed",
        "root_name": "Plate",
        "part_count": 1,
        "mesh_count": 1,
        "triangle_count": 100,
        "dimensions_mm": {"x": 200, "y": 100, "z": 3},
        "surface_area_mm2": 42000,
        "volume_mm3": 60000,
        "component_names": [],
        "shape_hint": "plate_like",
        "step_metadata": {
            "material_text": "SS 316L",
            "entity_counts": {"advanced_faces": 12, "cylindrical_surfaces": 2},
            "cylindrical_diameters_mm": [8]
        }
    })
    assert response.status_code == 200
    body = response.json()
    assert body["source_type"] == "cad"
    assert body["drawing"]["thickness_mm"] == 3
    assert body["drawing"]["weight_kg"] > 0
    assert isinstance(body["rows"], list)
    assert isinstance(body["ai_raw"]["dimensions"], list)
    assert isinstance(body["ai_raw"]["holes"], list)


def test_step_pmi_surface_finish_and_feature_quantity_are_preserved():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    response = client.post("/api/analyze-cad", json={
        "filename": "pmi_part.step",
        "file_hash": "pmi-step-hash",
        "format": "STEP",
        "parser_status": "parsed",
        "root_name": "PMI PART",
        "part_count": 1,
        "mesh_count": 1,
        "triangle_count": 200,
        "dimensions_mm": {"x": 100, "y": 50, "z": 10},
        "surface_area_mm2": 15000,
        "volume_mm3": 50000,
        "component_names": ["PMI PART"],
        "shape_hint": "plate_like",
        "step_metadata": {
            "cylindrical_diameters_mm": [10],
            "cylindrical_diameter_counts": {"10": 4},
            "hole_features": [{"type": "Hole", "diameter_mm": 10.0, "quantity": 4, "confidence": 88}],
            "surface_finish_labels": ["Ra 3.2"],
            "datum_labels": ["A"],
            "tolerance_labels": ["TOLERANCE ±0.1"],
            "geometric_tolerance_types": ["POSITION TOLERANCE"],
            "pmi_entity_counts": {"position_tolerance": 1},
            "entity_counts": {"advanced_faces": 12, "cylindrical_surfaces": 4},
        },
    })
    assert response.status_code == 200
    body = response.json()
    assert body["ai_raw"]["holes"][0]["quantity"] == 4
    assert body["ai_raw"]["surface_finish"][0]["value"] == "3.2"
    notes = " ".join(body["ai_raw"]["notes"])
    assert "Datum labels: A" in notes
    assert "POSITION TOLERANCE" in notes


def test_step_filename_316ss_drives_material_and_volume_weight():
    result = analyze_cad(CadAnalysisReq(
        filename="[PID#16005] 316SS Elbow, Custom.step",
        file_hash="316ss-file-hint",
        format="STEP",
        parser_status="parsed",
        root_name="316SS Elbow, Custom",
        part_count=1,
        mesh_count=1,
        triangle_count=2500,
        dimensions_mm={"x": 127.0, "y": 110.0, "z": 102.0},
        surface_area_mm2=42000.0,
        volume_mm3=125000.0,
        component_names=[],
        shape_hint="rotational_like",
        step_metadata={"entity_counts": {"advanced_faces": 28}},
    ))
    ai = result["ai_raw"]
    assert ai["material"]["family"] == "Stainless Steel"
    assert ai["material"]["grade"] == "AISI 316"
    # AISI 316-specific density (7.98 g/cm³) must win over the generic
    # stainless-family default (7.93 g/cm³).
    assert ai["weight_kg"] == 0.9975
    assert result["drawing"].weight_kg == 0.9975


def test_step_exact_geometry_dimensions_join_pdf_dimension_shape():
    result = analyze_cad(CadAnalysisReq(
        filename="elbow.step",
        file_hash="exact-dimensions",
        format="STEP",
        parser_status="parsed",
        root_name="Elbow",
        part_count=1,
        mesh_count=1,
        triangle_count=500,
        dimensions_mm={"x": 127.0, "y": 101.6, "z": 101.6},
        surface_area_mm2=25000.0,
        volume_mm3=90000.0,
        component_names=[],
        shape_hint="rotational_like",
        step_metadata={
            "geometry_dimensions": [
                {
                    "label": "Cylindrical Surface Ø101.6",
                    "value_mm": 101.6,
                    "quantity": 2,
                    "kind": "cylindrical_diameter",
                    "confidence": 96,
                    "review_required": True,
                    "basis": "Exact STEP CYLINDRICAL_SURFACE radius",
                },
                {
                    "label": "Torus / Bend Major Radius",
                    "value_mm": 76.2,
                    "quantity": 1,
                    "kind": "torus_major_radius",
                    "confidence": 96,
                    "review_required": True,
                    "basis": "Exact STEP TOROIDAL_SURFACE major radius",
                },
            ],
            "circle_diameters_mm": [101.6],
            "torus_radii_mm": [{"major_radius_mm": 76.2, "minor_radius_mm": 50.8}],
            "entity_counts": {"cylindrical_surfaces": 2, "toroidal_surfaces": 1},
        },
    ))
    dims = result["ai_raw"]["dimensions"]
    labels = [d["label"] for d in dims]
    assert "Overall X" in labels
    assert "Overall Y" in labels
    assert "Overall Z" in labels
    assert "Cylindrical Surface Ø101.6" in labels
    assert "Torus / Bend Major Radius" in labels
    exact = next(d for d in dims if d["label"] == "Cylindrical Surface Ø101.6")
    assert exact["value_mm"] == 101.6
    assert exact["quantity"] == 2
    assert exact["review_required"] is True


def test_step_file_endpoint_keeps_browser_geometry_when_python_ocp_unavailable():
    import json
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    browser_summary = {
        "filename": "[PID#16005] 316SS Elbow.step",
        "file_hash": "browser-hash",
        "format": "STEP",
        "parser_status": "parsed",
        "root_name": "316SS Elbow",
        "part_count": 1,
        "mesh_count": 1,
        "triangle_count": 500,
        "dimensions_mm": {"x": 127.0, "y": 101.6, "z": 101.6},
        "surface_area_mm2": 25000.0,
        "volume_mm3": 125000.0,
        "component_names": [],
        "shape_hint": "rotational_like",
        "step_metadata": {
            "geometry_dimensions": [
                {"label": "Circular Edge Ø101.6", "value_mm": 101.6, "quantity": 2, "kind": "circle_diameter", "confidence": 95}
            ],
            "cylindrical_diameters_mm": [101.6, 90.0],
        },
    }
    response = client.post(
        "/api/analyze-cad-file",
        files={"file": ("[PID#16005] 316SS Elbow.step", b"ISO-10303-21;FAKE;END-ISO-10303-21;", "application/step")},
        data={"browser_summary": json.dumps(browser_summary)},
    )
    assert response.status_code == 200
    body = response.json()
    assert "Stainless Steel" in body["drawing"]["material"]
    assert body["drawing"]["weight_kg"] > 0
    assert len(body["ai_raw"]["dimensions"]) >= 4
    assert body["source_type"] == "cad"


def test_step_solid_volume_weight_is_used_for_material_costing_not_sheet_blank():
    result = analyze_cad(CadAnalysisReq(
        filename="316SS elbow.step",
        file_hash="solid-cost",
        format="STEP",
        parser_status="parsed",
        root_name="316SS elbow",
        part_count=1,
        mesh_count=1,
        triangle_count=1000,
        dimensions_mm={"x": 127.0, "y": 101.6, "z": 101.6},
        surface_area_mm2=25000,
        volume_mm3=125000,
        component_names=[],
        shape_hint="rotational_like",
        step_metadata={"cylindrical_diameters_mm": [101.6, 90.0]},
    ))
    drawing = result["drawing"]
    material_row = next(row for row in result["rows"] if row.category == "MATERIAL")
    assert abs(material_row.costingQty - drawing.weight_kg) < 1e-9
    assert "STEP solid-volume weight" in material_row.drawingQty
    assert material_row.rate > 0
    assert material_row.cost > 0


def test_cad_feature_hints_only_use_deduplicated_server_holes():
    from app.main import _cad_feature_hints
    meta = {
        "cylindrical_diameters_mm": [10.0, 50.0],
        "cylindrical_diameter_counts": {"10": 8, "50": 1},
        "hole_features": [
            {"type": "Hole", "diameter_mm": 10.0, "quantity": 2, "confidence": 88, "review_required": True}
        ],
    }
    holes, _, _ = _cad_feature_hints(meta, (100.0, 50.0, 50.0))
    assert len(holes) == 1
    assert holes[0]["diameter_mm"] == 10.0
    assert holes[0]["quantity"] == 2


def test_cad_feature_hints_do_not_guess_holes_from_surface_counts():
    from app.main import _cad_feature_hints
    meta = {
        "cylindrical_diameters_mm": [10.0, 50.0],
        "cylindrical_diameter_counts": {"10": 8, "50": 1},
    }
    holes, _, _ = _cad_feature_hints(meta, (100.0, 50.0, 50.0))
    assert holes == []
