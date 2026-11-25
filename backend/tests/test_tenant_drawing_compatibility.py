"""Regression coverage: legacy reviews may share a DB with tenant ERP tables."""

import sqlite3
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import db
from app.extraction import ocr_runtime


def _isolated_database(monkeypatch, erp_drawings: bool):
    engine = create_engine(
        'sqlite+pysqlite:///:memory:',
        poolclass=StaticPool,
        connect_args={'check_same_thread': False},
    )
    if erp_drawings:
        with engine.begin() as connection:
            connection.execute(text('''
                CREATE TABLE drawings (
                    id VARCHAR(128) PRIMARY KEY,
                    tenant_id VARCHAR(128) NOT NULL,
                    rfq_id VARCHAR(128) NOT NULL,
                    storage_path TEXT NOT NULL UNIQUE,
                    file_name TEXT NOT NULL
                )
            '''))
    db.Base.metadata.create_all(engine)
    monkeypatch.setattr(db, 'engine', engine)
    monkeypatch.setattr(db, 'SessionLocal', sessionmaker(engine, expire_on_commit=False))
    return engine


def _drawing():
    return {
        'drawing_no': '316SS-TUBE-1',
        'revision': 'A',
        'description': 'Tube elbow',
        'material': '316SS',
        'thickness_mm': 1.5,
        'weight_kg': 2.0,
        'quantity': 1,
    }


def test_erp_drawings_remain_untouched_and_review_is_saved(monkeypatch):
    engine = _isolated_database(monkeypatch, erp_drawings=True)
    old_columns = set(inspect(engine).get_columns('drawings')[i]['name'] for i in range(5))
    assert db._ensure_schema_compatibility()['applied'] == []
    assert set(column['name'] for column in inspect(engine).get_columns('drawings')) == old_columns

    count = db.append_review_record({
        'id': 'LIVE-test-0001', 'created_at': '2026-11-21',
        'extraction_id': 'EXT-test-0001', 'file_hash': 'abc',
        'drawing': _drawing(),
        'rows': [{'category': 'MATERIAL', 'item': 'SS316', 'costingQty': 1, 'rate': 300, 'cost': 300}],
    })
    assert count == 1
    with db.SessionLocal() as session:
        assert session.scalar(select(db.ReviewRecord.payload).where(db.ReviewRecord.id == 'LIVE-test-0001'))['drawing']['material'] == '316SS'
        assert len(session.scalars(select(db.CostRowRecord)).all()) == 1
        assert session.execute(text('SELECT count(*) FROM drawings')).scalar_one() == 0

    db.append_extraction_record({
        'id': 'EXT-test-0001', 'created_at': '2026-11-21',
        'filename': 'tube.pdf', 'file_hash': 'abc',
        'source': 'local_pdf', 'drawing': _drawing(), 'rows': [],
    })
    with db.SessionLocal() as session:
        assert session.get(db.ExtractionRecord, 'EXT-test-0001').filename == 'tube.pdf'
        assert session.execute(text('SELECT count(*) FROM drawings')).scalar_one() == 0


def test_standalone_drawing_cache_keeps_working(monkeypatch):
    _isolated_database(monkeypatch, erp_drawings=False)
    db.append_review_record({
        'id': 'LIVE-test-0002', 'created_at': '2026-11-21',
        'extraction_id': '', 'file_hash': 'xyz',
        'drawing': _drawing(), 'rows': [],
    })
    with db.SessionLocal() as session:
        assert session.execute(text('SELECT drawing_no FROM drawings')).scalar_one() == '316SS-TUBE-1'


def test_onxx_ocr_is_deferred_on_512mb_not_on_larger_instances(monkeypatch):
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'true')
    monkeypatch.delenv('OCR_MIN_MEMORY_MB', raising=False)
    monkeypatch.setattr(ocr_runtime.shutil, 'which', lambda _binary: None)
    monkeypatch.setattr(ocr_runtime.importlib.util, 'find_spec', lambda module: object() if module in {'rapidocr', 'onnxruntime'} else None)
    monkeypatch.setattr(ocr_runtime, '_cgroup_memory_limit_bytes', lambda: 512 * 1024 * 1024)
    config = ocr_runtime.ocr_configuration()
    assert config['reason'] == 'insufficient_memory_for_ocr'
    assert not config['available']

    monkeypatch.setattr(ocr_runtime, '_cgroup_memory_limit_bytes', lambda: 1024 * 1024 * 1024)
    assert ocr_runtime.ocr_configuration()['available']
    monkeypatch.setenv('OCR_MIN_MEMORY_MB', '0')
    monkeypatch.setattr(ocr_runtime, '_cgroup_memory_limit_bytes', lambda: 512 * 1024 * 1024)
    assert ocr_runtime.ocr_configuration()['available']
