from typing import Literal
from pydantic import BaseModel, Field


Source = Literal["drawing", "calculated", "inferred"]


class Evidence(BaseModel):
    value: str | float | None = None
    source: Source = "inferred"
    confidence: float = Field(default=0.0, ge=0, le=1)
    evidence: str | None = None




class ProcessSuggestion(BaseModel):
    sequence: int = Field(ge=1, le=100)
    operation: str = Field(min_length=2, max_length=120)
    work_center: str | None = Field(default=None, max_length=120)
    reason: str | None = Field(default=None, max_length=300)
    confidence: float = Field(default=0.0, ge=0, le=1)

class Extraction(BaseModel):
    drawing_number: Evidence = Field(default_factory=Evidence)
    revision: Evidence = Field(default_factory=Evidence)
    description: Evidence = Field(default_factory=Evidence)
    material: Evidence = Field(default_factory=Evidence)
    quantity: Evidence = Field(default_factory=Evidence)
    length_mm: Evidence = Field(default_factory=Evidence)
    width_mm: Evidence = Field(default_factory=Evidence)
    thickness_mm: Evidence = Field(default_factory=Evidence)
    diameter_mm: Evidence = Field(default_factory=Evidence)
    drawing_weight_kg: Evidence = Field(default_factory=Evidence)
    units: Evidence = Field(default_factory=lambda: Evidence(value="mm", source="inferred", confidence=0.6))
    tolerance: Evidence = Field(default_factory=Evidence)
    surface_finish: Evidence = Field(default_factory=Evidence)
    weld_details: Evidence = Field(default_factory=Evidence)
    hole_thread_details: Evidence = Field(default_factory=Evidence)
    heat_treatment: Evidence = Field(default_factory=Evidence)
    coating: Evidence = Field(default_factory=Evidence)
    manufacturing_processes: list[ProcessSuggestion] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    raw_text: str = ""
