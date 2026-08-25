from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import (
    Boolean,
    Float,
    Integer,
    LargeBinary,
    String,
    Text,
    create_engine,
    delete,
    func,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

load_dotenv()

RAW_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if not RAW_DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Add the Neon PostgreSQL DATABASE_URL to backend/.env"
    )

if RAW_DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = RAW_DATABASE_URL.replace(
        "postgresql://",
        "postgresql+psycopg://",
        1,
    )
elif RAW_DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = RAW_DATABASE_URL.replace(
        "postgres://",
        "postgresql+psycopg://",
        1,
    )
else:
    DATABASE_URL = RAW_DATABASE_URL


class Base(DeclarativeBase):
    pass


class SettingsRecord(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class RateRecord(Base):
    __tablename__ = "rates"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    grade: Mapped[str] = mapped_column(String(180), default="")
    unit: Mapped[str] = mapped_column(String(30), default="job")
    price: Mapped[float] = mapped_column(Float, default=0)
    critical_score: Mapped[int] = mapped_column(Integer, default=50)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[str] = mapped_column(String(64), default="")


class DrawingRecord(Base):
    __tablename__ = "drawings"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    file_hash: Mapped[str] = mapped_column(String(128), default="", index=True)
    drawing_no: Mapped[str] = mapped_column(String(120), default="", index=True)
    revision: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    material: Mapped[str] = mapped_column(Text, default="")
    thickness_mm: Mapped[float] = mapped_column(Float, default=0)
    weight_kg: Mapped[float] = mapped_column(Float, default=0)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[str] = mapped_column(String(64), default="")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class ExtractionRecord(Base):
    __tablename__ = "extractions"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(64), default="", index=True)
    filename: Mapped[str] = mapped_column(Text, default="")
    file_hash: Mapped[str] = mapped_column(String(128), default="", index=True)
    source: Mapped[str] = mapped_column(String(60), default="")
    drawing_no: Mapped[str] = mapped_column(String(120), default="", index=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class ReviewRecord(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(64), default="", index=True)
    extraction_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    file_hash: Mapped[str] = mapped_column(String(128), default="", index=True)
    drawing_no: Mapped[str] = mapped_column(String(120), default="", index=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class RevisionRecord(Base):
    __tablename__ = "revisions"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(64), default="", index=True)
    drawing_no: Mapped[str] = mapped_column(String(120), default="", index=True)
    revision: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    material: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class QuotationRecord(Base):
    __tablename__ = "quotations"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(64), default="", index=True)
    customer: Mapped[str] = mapped_column(Text, default="", index=True)
    drawing_no: Mapped[str] = mapped_column(String(160), default="", index=True)
    revision: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    selling_price: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(60), default="Draft", index=True)
    batch_mode: Mapped[str] = mapped_column(String(30), default="")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class QuotationItemRecord(Base):
    __tablename__ = "quotation_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    quotation_id: Mapped[str] = mapped_column(String(80), index=True)
    line_no: Mapped[int] = mapped_column(Integer, default=1)
    drawing_no: Mapped[str] = mapped_column(String(120), default="", index=True)
    revision: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    selling_price: Mapped[float] = mapped_column(Float, default=0)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class CostRowRecord(Base):
    __tablename__ = "cost_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_type: Mapped[str] = mapped_column(String(30), index=True)
    owner_id: Mapped[str] = mapped_column(String(80), index=True)
    line_no: Mapped[int] = mapped_column(Integer, default=1)
    category: Mapped[str] = mapped_column(String(40), default="", index=True)
    item: Mapped[str] = mapped_column(Text, default="")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit: Mapped[str] = mapped_column(String(30), default="")
    rate: Mapped[float] = mapped_column(Float, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class TrainingSampleRecord(Base):
    __tablename__ = "training_samples"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(64), default="", index=True)
    filename: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(120), default="")
    file_hash: Mapped[str] = mapped_column(String(128), default="", unique=True, index=True)
    extraction_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    drawing_no: Mapped[str] = mapped_column(String(120), default="", index=True)
    customer: Mapped[str] = mapped_column(Text, default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    file_content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class DatasetMetaRecord(Base):
    __tablename__ = "dataset_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class SystemStateRecord(Base):
    __tablename__ = "system_state"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=int(os.getenv("DB_POOL_SIZE", "3")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "2")),
    pool_timeout=10,
    pool_recycle=300,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


def _rate_to_dict(row: RateRecord) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "name": row.name,
        "grade": row.grade,
        "unit": row.unit,
        "price": row.price,
        "critical_score": row.critical_score,
        "active": row.active,
        "notes": row.notes,
        "updated_at": row.updated_at,
    }


def _upsert_drawing(
    session,
    drawing: dict | None,
    file_hash: str = "",
    updated_at: str = "",
) -> None:
    if not isinstance(drawing, dict):
        return

    drawing_no = str(drawing.get("drawing_no") or "")
    revision = str(drawing.get("revision") or "")

    if file_hash:
        drawing_id = file_hash
    else:
        drawing_id = f"{drawing_no}::{revision}" or "unknown"

    row = session.get(DrawingRecord, drawing_id)

    values = {
        "id": drawing_id,
        "file_hash": file_hash,
        "drawing_no": drawing_no,
        "revision": revision,
        "description": str(drawing.get("description") or ""),
        "material": str(drawing.get("material") or ""),
        "thickness_mm": float(drawing.get("thickness_mm") or 0),
        "weight_kg": float(drawing.get("weight_kg") or 0),
        "quantity": max(1, int(drawing.get("quantity") or 1)),
        "updated_at": updated_at,
        "payload": drawing,
    }

    if row is None:
        session.add(DrawingRecord(**values))
    else:
        for key, value in values.items():
            setattr(row, key, value)


def _replace_cost_rows(
    session,
    owner_type: str,
    owner_id: str,
    rows: list[dict],
) -> None:
    session.execute(
        delete(CostRowRecord).where(
            CostRowRecord.owner_type == owner_type,
            CostRowRecord.owner_id == owner_id,
        )
    )

    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            continue

        session.add(
            CostRowRecord(
                owner_type=owner_type,
                owner_id=owner_id,
                line_no=index,
                category=str(row.get("category") or ""),
                item=str(row.get("item") or ""),
                quantity=float(row.get("costingQty") or 0),
                unit=str(row.get("unit") or ""),
                rate=float(row.get("rate") or 0),
                cost=float(row.get("cost") or 0),
                payload=row,
            )
        )


def load_store(name: str, default: Any):
    with SessionLocal() as session:
        if name == "settings":
            row = session.get(SettingsRecord, 1)
            return row.payload if row else default

        if name == "dataset_meta":
            row = session.get(DatasetMetaRecord, 1)
            return row.payload if row else default

        if name == "rates":
            rows = session.scalars(
                select(RateRecord).order_by(
                    RateRecord.category,
                    RateRecord.name,
                    RateRecord.grade,
                )
            ).all()
            return [_rate_to_dict(row) for row in rows] if rows else default

        if name == "extractions":
            rows = session.scalars(
                select(ExtractionRecord).order_by(
                    ExtractionRecord.created_at,
                    ExtractionRecord.id,
                )
            ).all()
            return [row.payload for row in rows] if rows else default

        if name == "reviews":
            rows = session.scalars(
                select(ReviewRecord).order_by(
                    ReviewRecord.created_at,
                    ReviewRecord.id,
                )
            ).all()
            return [row.payload for row in rows] if rows else default

        if name == "revisions":
            rows = session.scalars(
                select(RevisionRecord).order_by(
                    RevisionRecord.created_at,
                    RevisionRecord.id,
                )
            ).all()
            return [row.payload for row in rows] if rows else default

        if name == "quotations":
            rows = session.scalars(
                select(QuotationRecord).order_by(
                    QuotationRecord.created_at,
                    QuotationRecord.id,
                )
            ).all()
            return [row.payload for row in rows] if rows else default

    return default


def save_store(name: str, data: Any) -> None:
    with SessionLocal.begin() as session:
        if name == "settings":
            row = session.get(SettingsRecord, 1)
            payload = dict(data or {})
            if row is None:
                session.add(SettingsRecord(id=1, payload=payload))
            else:
                row.payload = payload
            return

        if name == "dataset_meta":
            row = session.get(DatasetMetaRecord, 1)
            payload = dict(data or {})
            if row is None:
                session.add(DatasetMetaRecord(id=1, payload=payload))
            else:
                row.payload = payload
            return

        if name == "rates":
            incoming = {
                str(item.get("id")): item
                for item in (data or [])
                if isinstance(item, dict) and item.get("id")
            }

            existing_ids = set(
                session.scalars(select(RateRecord.id)).all()
            )

            for removed_id in existing_ids - set(incoming):
                session.execute(
                    delete(RateRecord).where(RateRecord.id == removed_id)
                )

            for rate_id, item in incoming.items():
                row = session.get(RateRecord, rate_id)

                values = {
                    "id": rate_id,
                    "category": str(item.get("category") or "OTHER"),
                    "name": str(item.get("name") or ""),
                    "grade": str(item.get("grade") or ""),
                    "unit": str(item.get("unit") or "job"),
                    "price": float(item.get("price") or 0),
                    "critical_score": int(item.get("critical_score") or 0),
                    "active": bool(item.get("active", True)),
                    "notes": str(item.get("notes") or ""),
                    "updated_at": str(item.get("updated_at") or ""),
                }

                if row is None:
                    session.add(RateRecord(**values))
                else:
                    for key, value in values.items():
                        setattr(row, key, value)
            return

        if name == "extractions":
            incoming_ids = set()

            for item in data or []:
                if not isinstance(item, dict):
                    continue

                item_id = str(item.get("id") or "")
                if not item_id:
                    continue

                incoming_ids.add(item_id)
                row = session.get(ExtractionRecord, item_id)
                drawing = item.get("drawing") or {}

                values = {
                    "id": item_id,
                    "created_at": str(item.get("created_at") or ""),
                    "filename": str(item.get("filename") or ""),
                    "file_hash": str(item.get("file_hash") or ""),
                    "source": str(item.get("source") or ""),
                    "drawing_no": str(drawing.get("drawing_no") or ""),
                    "payload": item,
                }

                if row is None:
                    session.add(ExtractionRecord(**values))
                else:
                    for key, value in values.items():
                        setattr(row, key, value)

                _upsert_drawing(
                    session,
                    drawing,
                    str(item.get("file_hash") or ""),
                    str(item.get("created_at") or ""),
                )

            existing_ids = set(
                session.scalars(select(ExtractionRecord.id)).all()
            )

            for removed_id in existing_ids - incoming_ids:
                session.execute(
                    delete(ExtractionRecord).where(
                        ExtractionRecord.id == removed_id
                    )
                )
            return

        if name == "reviews":
            incoming_ids = set()

            for item in data or []:
                if not isinstance(item, dict):
                    continue

                item_id = str(item.get("id") or "")
                if not item_id:
                    continue

                incoming_ids.add(item_id)
                row = session.get(ReviewRecord, item_id)
                drawing = item.get("drawing") or {}

                values = {
                    "id": item_id,
                    "created_at": str(item.get("created_at") or ""),
                    "extraction_id": str(item.get("extraction_id") or ""),
                    "file_hash": str(item.get("file_hash") or ""),
                    "drawing_no": str(drawing.get("drawing_no") or ""),
                    "payload": item,
                }

                if row is None:
                    session.add(ReviewRecord(**values))
                else:
                    for key, value in values.items():
                        setattr(row, key, value)

                _upsert_drawing(
                    session,
                    drawing,
                    str(item.get("file_hash") or ""),
                    str(item.get("created_at") or ""),
                )

                _replace_cost_rows(
                    session,
                    "review",
                    item_id,
                    item.get("rows") or [],
                )

            existing_ids = set(
                session.scalars(select(ReviewRecord.id)).all()
            )

            for removed_id in existing_ids - incoming_ids:
                session.execute(
                    delete(ReviewRecord).where(
                        ReviewRecord.id == removed_id
                    )
                )
                session.execute(
                    delete(CostRowRecord).where(
                        CostRowRecord.owner_type == "review",
                        CostRowRecord.owner_id == removed_id,
                    )
                )
            return

        if name == "revisions":
            incoming_ids = set()

            for item in data or []:
                if not isinstance(item, dict):
                    continue

                item_id = str(item.get("id") or "")
                if not item_id:
                    continue

                incoming_ids.add(item_id)
                row = session.get(RevisionRecord, item_id)

                values = {
                    "id": item_id,
                    "created_at": str(item.get("created_at") or ""),
                    "drawing_no": str(item.get("drawing_no") or ""),
                    "revision": str(item.get("revision") or ""),
                    "description": str(item.get("description") or ""),
                    "material": str(item.get("material") or ""),
                    "note": str(item.get("note") or ""),
                    "payload": item,
                }

                if row is None:
                    session.add(RevisionRecord(**values))
                else:
                    for key, value in values.items():
                        setattr(row, key, value)

            existing_ids = set(
                session.scalars(select(RevisionRecord.id)).all()
            )

            for removed_id in existing_ids - incoming_ids:
                session.execute(
                    delete(RevisionRecord).where(
                        RevisionRecord.id == removed_id
                    )
                )
            return

        if name == "quotations":
            incoming_ids = set()

            for item in data or []:
                if not isinstance(item, dict):
                    continue

                item_id = str(item.get("id") or "")
                if not item_id:
                    continue

                incoming_ids.add(item_id)
                row = session.get(QuotationRecord, item_id)

                values = {
                    "id": item_id,
                    "created_at": str(item.get("created_at") or ""),
                    "customer": str(item.get("customer") or ""),
                    "drawing_no": str(item.get("drawing_no") or ""),
                    "revision": str(item.get("revision") or ""),
                    "description": str(item.get("description") or ""),
                    "selling_price": float(item.get("selling_price") or 0),
                    "status": str(item.get("status") or "Draft"),
                    "batch_mode": str(item.get("batch_mode") or ""),
                    "payload": item,
                }

                if row is None:
                    session.add(QuotationRecord(**values))
                else:
                    for key, value in values.items():
                        setattr(row, key, value)

                session.execute(
                    delete(QuotationItemRecord).where(
                        QuotationItemRecord.quotation_id == item_id
                    )
                )
                session.execute(
                    delete(CostRowRecord).where(
                        CostRowRecord.owner_type == "quotation",
                        CostRowRecord.owner_id == item_id,
                    )
                )

                if isinstance(item.get("items"), list):
                    for line_no, quote_item in enumerate(item["items"], 1):
                        drawing = quote_item.get("drawing") or {}
                        summary = quote_item.get("summary") or {}
                        rows = quote_item.get("rows") or []

                        session.add(
                            QuotationItemRecord(
                                quotation_id=item_id,
                                line_no=line_no,
                                drawing_no=str(
                                    drawing.get("drawing_no") or ""
                                ),
                                revision=str(
                                    drawing.get("revision") or ""
                                ),
                                description=str(
                                    drawing.get("description") or ""
                                ),
                                quantity=max(
                                    1,
                                    int(drawing.get("quantity") or 1),
                                ),
                                selling_price=float(
                                    summary.get("selling_price") or 0
                                ),
                                payload=quote_item,
                            )
                        )

                        _replace_cost_rows(
                            session,
                            "quotation_item",
                            f"{item_id}:{line_no}",
                            rows,
                        )
                else:
                    drawing = item.get("drawing") or {}
                    summary = item.get("summary") or {}
                    rows = item.get("rows") or []

                    session.add(
                        QuotationItemRecord(
                            quotation_id=item_id,
                            line_no=1,
                            drawing_no=str(
                                drawing.get("drawing_no")
                                or item.get("drawing_no")
                                or ""
                            ),
                            revision=str(
                                drawing.get("revision")
                                or item.get("revision")
                                or ""
                            ),
                            description=str(
                                drawing.get("description")
                                or item.get("description")
                                or ""
                            ),
                            quantity=max(
                                1,
                                int(drawing.get("quantity") or 1),
                            ),
                            selling_price=float(
                                summary.get("selling_price")
                                or item.get("selling_price")
                                or 0
                            ),
                            payload={
                                "drawing": drawing,
                                "summary": summary,
                                "rows": rows,
                            },
                        )
                    )

                    _replace_cost_rows(
                        session,
                        "quotation",
                        item_id,
                        rows,
                    )

            existing_ids = set(
                session.scalars(select(QuotationRecord.id)).all()
            )

            for removed_id in existing_ids - incoming_ids:
                session.execute(
                    delete(QuotationRecord).where(
                        QuotationRecord.id == removed_id
                    )
                )
                session.execute(
                    delete(QuotationItemRecord).where(
                        QuotationItemRecord.quotation_id == removed_id
                    )
                )
                session.execute(
                    delete(CostRowRecord).where(
                        CostRowRecord.owner_type.in_(
                            ["quotation", "quotation_item"]
                        ),
                        CostRowRecord.owner_id.like(f"{removed_id}%"),
                    )
                )
            return

        raise ValueError(f"Unsupported database store: {name}")



def append_extraction_record(item: dict) -> None:
    """Insert one extraction without loading/re-writing the full extraction table."""
    if not isinstance(item, dict):
        return

    item_id = str(item.get("id") or "")
    if not item_id:
        return

    drawing = item.get("drawing") or {}

    with SessionLocal.begin() as session:
        row = session.get(ExtractionRecord, item_id)

        values = {
            "id": item_id,
            "created_at": str(item.get("created_at") or ""),
            "filename": str(item.get("filename") or ""),
            "file_hash": str(item.get("file_hash") or ""),
            "source": str(item.get("source") or ""),
            "drawing_no": str(drawing.get("drawing_no") or ""),
            "payload": item,
        }

        if row is None:
            session.add(ExtractionRecord(**values))
        else:
            for key, value in values.items():
                setattr(row, key, value)

        _upsert_drawing(
            session,
            drawing,
            str(item.get("file_hash") or ""),
            str(item.get("created_at") or ""),
        )


def append_review_record(item: dict) -> int:
    """Insert one engineer review and its costing rows."""
    if not isinstance(item, dict):
        return 0

    item_id = str(item.get("id") or "")
    if not item_id:
        return 0

    drawing = item.get("drawing") or {}

    with SessionLocal.begin() as session:
        row = session.get(ReviewRecord, item_id)

        values = {
            "id": item_id,
            "created_at": str(item.get("created_at") or ""),
            "extraction_id": str(item.get("extraction_id") or ""),
            "file_hash": str(item.get("file_hash") or ""),
            "drawing_no": str(drawing.get("drawing_no") or ""),
            "payload": item,
        }

        if row is None:
            session.add(ReviewRecord(**values))
        else:
            for key, value in values.items():
                setattr(row, key, value)

        _upsert_drawing(
            session,
            drawing,
            str(item.get("file_hash") or ""),
            str(item.get("created_at") or ""),
        )

        _replace_cost_rows(
            session,
            "review",
            item_id,
            item.get("rows") or [],
        )

    with SessionLocal() as session:
        return int(
            session.scalar(
                select(func.count()).select_from(ReviewRecord)
            ) or 0
        )


def latest_review_by_hash(file_hash: str) -> dict | None:
    """Return the newest reviewed correction for one exact drawing hash."""
    if not file_hash:
        return None

    with SessionLocal() as session:
        row = session.scalars(
            select(ReviewRecord)
            .where(ReviewRecord.file_hash == file_hash)
            .order_by(ReviewRecord.created_at.desc())
            .limit(1)
        ).first()

        return row.payload if row else None


def upsert_training_sample(item: dict, file_content: bytes) -> tuple[dict, int]:
    """
    Curated training store. One source drawing hash maps to one current approved
    training sample, so repeatedly sending the same drawing updates it instead
    of overweighting the dataset with duplicates.
    """
    if not isinstance(item, dict):
        raise ValueError("Training sample payload is invalid.")

    file_hash = str(item.get("file_hash") or "")
    if not file_hash:
        raise ValueError("Training sample file_hash is required.")

    sample_id = str(item.get("id") or f"TRN-{file_hash[:16].upper()}")
    drawing = item.get("drawing") or {}

    with SessionLocal.begin() as session:
        row = session.scalars(
            select(TrainingSampleRecord)
            .where(TrainingSampleRecord.file_hash == file_hash)
            .limit(1)
        ).first()

        values = {
            "id": sample_id,
            "created_at": str(item.get("created_at") or ""),
            "filename": str(item.get("filename") or ""),
            "content_type": str(item.get("content_type") or ""),
            "file_hash": file_hash,
            "extraction_id": str(item.get("extraction_id") or ""),
            "drawing_no": str(drawing.get("drawing_no") or ""),
            "customer": str(item.get("customer") or ""),
            "file_size": len(file_content or b""),
            "file_content": file_content,
            "payload": item,
        }

        if row is None:
            row = TrainingSampleRecord(**values)
            session.add(row)
        else:
            # Preserve the original stable DB id while replacing the approved target.
            values["id"] = row.id
            for key, value in values.items():
                setattr(row, key, value)

        _upsert_drawing(
            session,
            drawing,
            file_hash,
            str(item.get("created_at") or ""),
        )

    with SessionLocal() as session:
        count = int(
            session.scalar(
                select(func.count()).select_from(TrainingSampleRecord)
            ) or 0
        )

    return item, count


def training_samples_for_export() -> list[tuple[dict, bytes, str]]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(TrainingSampleRecord).order_by(
                TrainingSampleRecord.created_at,
                TrainingSampleRecord.id,
            )
        ).all()

        return [
            (row.payload, bytes(row.file_content or b""), row.filename)
            for row in rows
        ]


def dataset_counts_fast() -> dict:
    """Small aggregate queries used by the dashboard instead of loading all JSON payloads."""
    with SessionLocal() as session:
        return {
            "extractions": int(
                session.scalar(
                    select(func.count()).select_from(ExtractionRecord)
                ) or 0
            ),
            "reviews": int(
                session.scalar(
                    select(func.count()).select_from(ReviewRecord)
                ) or 0
            ),
            "training_samples": int(
                session.scalar(
                    select(func.count()).select_from(TrainingSampleRecord)
                ) or 0
            ),
            "unique_files": int(
                session.scalar(
                    select(
                        func.count(
                            func.distinct(ExtractionRecord.file_hash)
                        )
                    )
                ) or 0
            ),
        }

def database_stats() -> dict:
    with SessionLocal() as session:
        return {
            "drawings": session.scalar(
                select(func.count()).select_from(DrawingRecord)
            ) or 0,
            "rates": session.scalar(
                select(func.count()).select_from(RateRecord)
            ) or 0,
            "extractions": session.scalar(
                select(func.count()).select_from(ExtractionRecord)
            ) or 0,
            "reviews": session.scalar(
                select(func.count()).select_from(ReviewRecord)
            ) or 0,
            "training_samples": session.scalar(
                select(func.count()).select_from(TrainingSampleRecord)
            ) or 0,
            "revisions": session.scalar(
                select(func.count()).select_from(RevisionRecord)
            ) or 0,
            "quotations": session.scalar(
                select(func.count()).select_from(QuotationRecord)
            ) or 0,
            "quotation_items": session.scalar(
                select(func.count()).select_from(QuotationItemRecord)
            ) or 0,
            "cost_rows": session.scalar(
                select(func.count()).select_from(CostRowRecord)
            ) or 0,
        }


def db_ping() -> bool:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _table_has_data(name: str) -> bool:
    with SessionLocal() as session:
        model = {
            "settings": SettingsRecord,
            "rates": RateRecord,
            "extractions": ExtractionRecord,
            "reviews": ReviewRecord,
            "quotations": QuotationRecord,
            "revisions": RevisionRecord,
            "dataset_meta": DatasetMetaRecord,
        }[name]

        count = session.scalar(
            select(func.count()).select_from(model)
        ) or 0

        return count > 0


def migrate_legacy_json(data_dir: Path) -> dict:
    state_key = "legacy_json_v1"

    with SessionLocal() as session:
        existing = session.get(SystemStateRecord, state_key)
        if existing:
            return existing.payload

    migrated: list[str] = []
    skipped: list[str] = []

    for name in [
        "settings",
        "rates",
        "extractions",
        "reviews",
        "quotations",
        "revisions",
        "dataset_meta",
    ]:
        path = data_dir / f"{name}.json"

        if not path.exists():
            continue

        if _table_has_data(name):
            skipped.append(name)
            continue

        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            save_store(name, value)
            migrated.append(name)
        except Exception:
            skipped.append(name)

    result = {
        "migrated": migrated,
        "skipped": skipped,
    }

    with SessionLocal.begin() as session:
        session.add(
            SystemStateRecord(
                key=state_key,
                payload=result,
            )
        )

    return result


def init_database(legacy_data_dir: Path | None = None) -> dict:
    Base.metadata.create_all(engine)

    migration = {
        "migrated": [],
        "skipped": [],
    }

    if legacy_data_dir is not None:
        migration = migrate_legacy_json(legacy_data_dir)

    return {
        "database": "connected",
        "legacy_migration": migration,
    }
