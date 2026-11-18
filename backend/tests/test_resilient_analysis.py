from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_fallback_returns_editable_predicted_review():
    response = client.post(
        "/api/analyze-fallback",
        json={
            "filename": "unknown_part.dwg",
            "source_format": "DWG",
            "reason": "parser unavailable",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ai_raw"]["prediction_status"] == "predicted_review_required"
    assert payload["drawing"]["material"] == "Predicted / Review Required"
    assert payload["dfm"] is None
    assert payload["bom"] is None


def test_cad_endpoint_does_not_reference_undefined_features():
    response = client.post(
        "/api/analyze-cad",
        json={
            "filename": "part.step",
            "file_hash": "a" * 64,
            "format": "STEP",
            "parser_status": "parsed",
            "root_name": "Part",
            "part_count": 1,
            "mesh_count": 1,
            "triangle_count": 120,
            "dimensions_mm": {"x": 120, "y": 80, "z": 10},
            "surface_area_mm2": 10000,
            "volume_mm3": 96000,
            "component_names": [],
            "shape_hint": "plate_like",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ai_raw"]["chamfers"] == []
    assert payload["ai_raw"]["bends"] == []
    assert payload["ai_raw"]["welds"] == []
    assert payload["drawing"]["drawing_no"] == "part"


def test_drawing_primary_key_supports_legacy_uuid_schema():
    from app.db import _drawing_primary_key

    digest = "98ce406bca30a7ed636b71df7c838259072d61e76fd225e227ffc70a736543fb"
    uuid_key = _drawing_primary_key(digest, "UUID")
    assert len(uuid_key) == 36
    assert uuid_key.count("-") == 4
    assert _drawing_primary_key(digest, "VARCHAR(128)") == digest


def test_workspace_file_upload_and_download_round_trip():
    session_id = "preview-test-session"
    payload = {"step": 2, "quoteIds": ["preview-test-quote"]}

    saved_session = client.put(
        f"/api/workspaces/{session_id}",
        json={"name": "Preview persistence test", "payload": payload},
    )
    assert saved_session.status_code == 200

    content = b"ISO-10303-21;\nHEADER;\nENDSEC;\n"
    uploaded = client.post(
        f"/api/workspaces/{session_id}/files",
        data={"role": "model"},
        files={"file": ("sample.step", content, "application/step")},
    )
    assert uploaded.status_code == 200
    file_id = uploaded.json()["id"]

    session = client.get(f"/api/workspaces/{session_id}")
    assert session.status_code == 200
    assert session.json()["payload"]["quoteIds"] == ["preview-test-quote"]
    assert any(item["id"] == file_id for item in session.json()["files"])

    downloaded = client.get(f"/api/workspaces/{session_id}/files/{file_id}")
    assert downloaded.status_code == 200
    assert downloaded.content == content
