"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import ModelViewer from "@/components/ModelViewer";
import {
  inspectCadFile,
  isVisualCadFormat
} from "@/lib/cad";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import * as api from "@/lib/api";
import type {
  AIExtraction,
  AnalysisResponse,
  BatchQuoteItem,
  BatchQuoteMode,
  BomReport,
  CostRow,
  DatasetStats,
  DfmReport,
  DrawingDetails,
  QuoteRecord,
  QuoteSummary,
  RateCatalog,
  RateItem,
  RevisionComparison,
  RevisionRecord,
  Settings,
  PremiumEstimate
} from "@/lib/types";

type View = "dashboard" | "workflow" | "quotes" | "rates" | "dfm" | "bom" | "dataset" | "settings";
type RateTab = "MATERIAL" | "PROCESS" | "LABOUR" | "OTHER" | "COMMERCIAL" | "ALL";


type BatchWorkspace = {
  id: string;
  file: File;
  analysis: AnalysisResponse;
  drawing: DrawingDetails;
  rows: CostRow[];
  summary: QuoteSummary;
};


type BatchFailure = {
  file: File;
  error: string;
};


const BATCH_ANALYZE_CONCURRENCY = 2; // Keep AI calls conservative; per-drawing work is optimized below.
const DFM_HISTORY_KEY = "dfab-dfm-history-v080";
const BOM_HISTORY_KEY = "dfab-bom-history-v080";
type ArtifactJobState = "processing" | "ready" | "review" | "attention" | "failed";


const emptySummary: QuoteSummary = {
  direct_cost: 0,
  material_wastage: 0,
  overhead: 0,
  manufacturing_cost: 0,
  markup: 0,
  selling_price: 0,
  material_wastage_pct: 0,
  overhead_pct: 0,
  markup_pct: 0,
  material_wastage_critical: 0,
  overhead_critical: 0,
  markup_critical: 0
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value || 0);

const rateChoiceLabel = (rate: RateItem) =>
  rate.category === "MATERIAL" && rate.grade
    ? `${rate.name} — ${rate.grade}`
    : rate.name;

function criticalLabel(score: number, medium = 40, high = 70) {
  if (score >= high) return "High";
  if (score >= medium) return "Medium";
  return "Low";
}


function compactAnalysisLine(data: AIExtraction | null | undefined) {
  if (!data) return "No additional features detected.";

  const parts: string[] = [];

  if (data.dimensions?.length) parts.push(`${data.dimensions.length} dimensions`);

  const holeQty = (data.holes || []).reduce((sum, item) => {
    const value = Number(item.quantity ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  if (holeQty) parts.push(`${holeQty} holes/slots`);

  const threadQty = (data.threads || []).reduce((sum, item) => {
    const value = Number(item.quantity ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  if (threadQty) parts.push(`${threadQty} threaded features`);

  if (data.chamfers?.length) parts.push(`${data.chamfers.length} chamfer callouts`);
  if (data.bends?.length) parts.push(`${data.bends.length} bend callouts`);
  if (data.welds?.length) parts.push(`${data.welds.length} weld callouts`);
  if (data.manufacturing_processes?.length) parts.push(`${data.manufacturing_processes.length} processes`);

  const notes = (data.notes || [])
    .map((item) => String(item))
    .filter(Boolean)
    .slice(0, 2);
  parts.push(...notes);

  return parts.length ? parts.join(" • ") : "Basic drawing details extracted.";
}


type Signal = "green" | "yellow" | "red";

function signalFromConfidence(value: unknown): Signal {
  const score = Number(value ?? 0);
  if (score >= 85) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

function costRowSignal(row?: CostRow): Signal {
  if (!row) return "yellow";
  if (Number(row.rate || 0) <= 0 || row.confidence === "Assumed") return "red";
  if (row.confidence === "Estimated" || row.rateSource === "Manual Override") return "yellow";
  return "green";
}

function signalLabel(signal: Signal) {
  if (signal === "green") return "Ready";
  if (signal === "yellow") return "Review";
  return "Attention";
}

function StatusDot({ signal, label }: { signal: Signal; label?: string }) {
  const text = label || signalLabel(signal);
  return (
    <span className={`row-status ${signal}`} title={text} aria-label={text}>
      <i/>
      <span>{text}</span>
    </span>
  );
}


const REVIEW_SECTION_MAP: Array<[string[], string]> = [
  [["specification", "material spec", "spec"], "sheet-summary-specification"],
  [["grade"], "sheet-summary-grade"],
  [["material"], "sheet-summary-material"],
  [["drawing type", "document type"], "sheet-summary-drawing-type"],
  [["thickness", "thick"], "sheet-summary-thickness"],
  [["weight", "mass"], "sheet-summary-weight"],
  [["quantity", "qty"], "sheet-summary-quantity"],
  [["hole", "slot", "diameter", "thru"], "sheet-holes"],
  [["thread", "tap", "tapping", "m16", "m12", "m10", "m8", "m6", "m5", "m4", "m3"], "sheet-threads"],
  [["chamfer"], "sheet-chamfers"],
  [["bend", "forming", "angle"], "sheet-bends"],
  [["stud", "fastener", "bolt"], "sheet-studs"],
  [["weld", "tack"], "sheet-welds"],
  [["surface", "finish", "polish", "passivation", "coat"], "sheet-surface-finish"],
  [["process", "machining", "machine", "laser", "cutting", "drilling", "turning"], "sheet-processes"],
  [["dimension", "length", "width", "height", "radius"], "sheet-dimensions"]
];

function reviewTargetId(text: string, data: AIExtraction | null) {
  const lower = text.toLowerCase();

  for (const [keywords, id] of REVIEW_SECTION_MAP) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      const sectionKey = id.replace("sheet-", "");

      const rowsBySection: Record<string, Record<string, unknown>[]> = {
        dimensions: (data?.dimensions || []) as Record<string, unknown>[],
        holes: (data?.holes || []) as Record<string, unknown>[],
        threads: (data?.threads || []) as Record<string, unknown>[],
        chamfers: (data?.chamfers || []) as Record<string, unknown>[],
        bends: (data?.bends || []) as Record<string, unknown>[],
        studs: (data?.studs || []) as Record<string, unknown>[],
        welds: (data?.welds || []) as Record<string, unknown>[],
        processes: (data?.manufacturing_processes || []) as Record<string, unknown>[]
      };

      const sectionRows = rowsBySection[sectionKey];

      if (sectionRows?.length) {
        const tokens = lower
          .split(/[^a-z0-9.]+/)
          .filter((token) => token.length >= 3);

        const matchIndex = sectionRows.findIndex((row) => {
          const hay = JSON.stringify(row).toLowerCase();
          return tokens.some((token) => hay.includes(token));
        });

        if (matchIndex >= 0) return `${id}-row-${matchIndex}`;

        const attentionIndex = sectionRows.findIndex(
          (row) => Number(row.confidence ?? 0) < 85
        );

        if (attentionIndex >= 0) return `${id}-row-${attentionIndex}`;
      }

      return id;
    }
  }

  return "sheet-review";
}

function scrollToSheetTarget(targetId: string) {
  const node = document.getElementById(targetId);
  if (!node) return false;

  node.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  node.classList.add("review-focus");
  const focusable = node.querySelector<HTMLElement>("input, select, textarea, button");
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 420);
  window.setTimeout(() => node.classList.remove("review-focus"), 2200);
  return true;
}

function blankRate(): RateItem {
  return {
    id: "",
    category: "MATERIAL",
    name: "Stainless Steel",
    grade: "AISI 304",
    unit: "kg",
    price: 0,
    critical_score: 70,
    active: true,
    notes: "",
    updated_at: ""
  };
}

const ACTIVE_DRAFT_DB = "dfab-manufacturing-quotation";
const ACTIVE_DRAFT_STORE = "workflow";
const WORKSPACE_DATASET_STORE = "workspace-datasets";
const ACTIVE_DRAFT_KEY = "active-quotation-v085";

function createWorkspaceDatasetId() {
  return `dataset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type CommercialAmountOverrides = {
  material_wastage: number | null;
  overhead: number | null;
  markup: number | null;
};

type MaterialShape = "plate" | "round_bar" | "pipe" | "rect_tube" | "angle";

type MaterialCalculatorState = {
  rowId: string;
  shape: MaterialShape;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  diameterMm: number;
  outerDiameterMm: number;
  innerDiameterMm: number;
  wallThicknessMm: number;
  legAMm: number;
  legBMm: number;
  quantity: number;
  densityKgM3: number;
  pricePerKg: number;
  predictedBaseWeightKg: number;
  allowanceKg: number;
  predictedTotalWeightKg: number;
  predictionBasis: string;
};

const EMPTY_MATERIAL_CALCULATOR: MaterialCalculatorState = {
  rowId: "",
  shape: "plate",
  lengthMm: 0,
  widthMm: 0,
  heightMm: 0,
  thicknessMm: 0,
  diameterMm: 0,
  outerDiameterMm: 0,
  innerDiameterMm: 0,
  wallThicknessMm: 0,
  legAMm: 0,
  legBMm: 0,
  quantity: 1,
  densityKgM3: 7850,
  pricePerKg: 0,
  predictedBaseWeightKg: 0,
  allowanceKg: 1,
  predictedTotalWeightKg: 0,
  predictionBasis: ""
};

function inferMaterialDensity(material: string) {
  return recognizedMaterialDensityKgM3(material);
}

function inferMaterialShape(data: AIExtraction | null | undefined): MaterialShape {
  const hint = `${data?.part_form || ""} ${data?.cad_geometry?.shape_hint || ""}`.toLowerCase();
  if (hint.includes("pipe") || hint.includes("tube") || hint.includes("hollow")) return "pipe";
  if (hint.includes("round") || hint.includes("cylinder") || hint.includes("rod") || hint.includes("bar")) return "round_bar";
  if (hint.includes("angle")) return "angle";
  return "plate";
}

function materialVolumeMm3(value: MaterialCalculatorState) {
  const length = Math.max(0, Number(value.lengthMm || 0));
  if (value.shape === "plate") {
    return length * Math.max(0, value.widthMm) * Math.max(0, value.thicknessMm);
  }
  if (value.shape === "round_bar") {
    const d = Math.max(0, value.diameterMm);
    return Math.PI * d * d / 4 * length;
  }
  if (value.shape === "pipe") {
    const od = Math.max(0, value.outerDiameterMm);
    const id = Math.max(0, value.innerDiameterMm);
    return Math.PI * Math.max(0, od * od - id * id) / 4 * length;
  }
  if (value.shape === "rect_tube") {
    const width = Math.max(0, value.widthMm);
    const height = Math.max(0, value.heightMm);
    const wall = Math.max(0, value.wallThicknessMm);
    const innerWidth = Math.max(0, width - 2 * wall);
    const innerHeight = Math.max(0, height - 2 * wall);
    return Math.max(0, width * height - innerWidth * innerHeight) * length;
  }
  const legA = Math.max(0, value.legAMm);
  const legB = Math.max(0, value.legBMm);
  const thickness = Math.max(0, value.thicknessMm);
  return Math.max(0, thickness * (legA + legB - thickness)) * length;
}

function recognizedMaterialDensityKgM3(material: string) {
  const value = String(material || "").toLowerCase();
  if (!value.trim()) return 0;
  if (value.includes("aluminium") || value.includes("aluminum")) return 2700;
  if (value.includes("copper")) return 8960;
  if (value.includes("brass")) return 8500;
  if (value.includes("titanium")) return 4500;
  if (value.includes("stainless") || /\bss\s*\d/i.test(value) || value.startsWith("ss")) return 8000;
  if (value.includes("mild steel") || value.includes("carbon steel") || value.includes("structural steel") || value.includes("galvanized steel") || value === "steel" || /\bsteel\b/i.test(value) || /\bsa\s*516\b/i.test(value) || /\ba\s*36\b/i.test(value)) return 7850;
  if (value.includes("cast iron")) return 7200;
  if (value.includes("inconel")) return 8440;
  if (value.includes("nickel")) return 8900;
  if (value.includes("bronze")) return 8800;
  return 0;
}

function numericFeatureValue(row: Record<string, unknown> | undefined, key: string) {
  const value = Number(row?.[key] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}


function parseDrawingLengthMm(token: string, unitToken = "mm") {
  const cleaned = String(token || "").trim().replace(/\s+/g, " ");
  let numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    const mixed = cleaned.match(/^(\d+)\s*[- ]\s*(\d+)\/(\d+)$/);
    const fraction = cleaned.match(/^(\d+)\/(\d+)$/);
    if (mixed) numeric = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    else if (fraction) numeric = Number(fraction[1]) / Number(fraction[2]);
  }
  if (!(Number.isFinite(numeric) && numeric > 0)) return 0;
  return engineeringLengthToMm(numeric, unitToken);
}

function thicknessFromEngineeringText(data: AIExtraction) {
  const sources = [
    ...(data.notes || []),
    ...(data.missing_or_uncertain || []),
    ...(data.evidence || []).flatMap((row) => [row.field, row.value, row.basis])
  ].map((item) => String(item || ""));

  for (const source of sources) {
    const direct = source.match(/(?:thk|thick(?:ness)?|plate\s*t|sheet\s*t|wall(?:\s*thickness)?|\bt)\s*[:=x×-]?\s*(\d+\s*[- ]\s*\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(mm|inches|inch|in|\")?/i);
    if (direct) {
      const value = parseDrawingLengthMm(direct[1], direct[2] || "mm");
      if (value > 0) return { value, basis: direct[2] && !/^mm$/i.test(direct[2]) ? "Imperial thickness callout converted to mm" : "Thickness value found in drawing evidence/notes" };
    }

    const stock = source.match(/(?:plate|sheet|flat|strip|blank|size)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
    if (stock) {
      const values = stock.slice(1).map(Number).filter((item) => Number.isFinite(item) && item > 0).sort((a, b) => a - b);
      if (values.length === 3) return { value: values[0], basis: "Plate/sheet stock-size callout" };
    }
  }

  return null;
}

const DEFAULT_FALLBACK_THICKNESS_MM = 100;

function predictedThickness(data: AIExtraction | null | undefined, drawing: DrawingDetails): { value: number; basis: string; isFallback?: boolean } | null {
  if (!data) return null;

  const explicit = Number(data.thickness_mm || drawing.thickness_mm || 0);
  if (explicit > 0) return { value: explicit, basis: "Drawing thickness callout" };

  const dimensions = ((data.dimensions || []) as Record<string, unknown>[])
    .map((row) => ({
      label: String(row.label || row.type || row.description || "").toLowerCase(),
      value: normalizedDimensionMm(row)
    }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0);

  const labelled = dimensions.find((row) =>
    /(^|\b)(thickness|thick|thk|plate\s*t|sheet\s*t|wall|wall\s*thickness|gauge)(\b|$)/i.test(row.label)
  );
  if (labelled?.value) return { value: labelled.value, basis: "Thickness-labelled drawing dimension" };

  const textPrediction = thicknessFromEngineeringText(data);
  if (textPrediction) return textPrediction;

  const componentThicknesses = ((data.assembly_parts || []) as Record<string, unknown>[])
    .map((part) => Number(part.thickness_mm || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (componentThicknesses.length) {
    const unique = Array.from(new Set(componentThicknesses.map((value) => Number(value.toFixed(3)))));
    if (unique.length === 1) return { value: unique[0], basis: "Uniform assembly/component plate thickness" };
  }

  const geometry = data.cad_geometry?.dimensions_mm || {};
  const axes = [Number(geometry.x || 0), Number(geometry.y || 0), Number(geometry.z || 0)]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const form = `${data.part_form || ""} ${data.cad_geometry?.shape_hint || ""} ${data.drawing_type || ""}`.toLowerCase();
  const plateLike = /plate|sheet|bracket|cover|panel|enclosure|flat|strip|sheet_metal/.test(form);

  if (axes.length === 3 && plateLike) {
    const [smallest, middle] = axes;
    if (smallest > 0 && middle / smallest >= 1.5) {
      return { value: smallest, basis: "Plate-like CAD geometry: smallest overall axis" };
    }
  }

  if (plateLike) {
    const values = Array.from(new Set(dimensions.map((row) => Number(row.value.toFixed(3)))))
      .filter((value) => value > 0)
      .sort((a, b) => a - b);

    if (values.length >= 3) {
      const smallest = values[0];
      const next = values[1];
      if (smallest <= 50 && next / smallest >= 1.35) {
        return { value: smallest, basis: "Plate-like drawing geometry: smallest physical dimension" };
      }
    }
  }

  return null;
}

function parsedEngineeringEnvelopeMm(data: AIExtraction) {
  const labelled: { label: string; value: number }[] = [];
  const push = (label: unknown, raw: unknown) => {
    const value = Number(raw || 0);
    if (Number.isFinite(value) && value > 0) labelled.push({ label: String(label || "").toLowerCase(), value });
  };

  for (const row of (data.dimensions || []) as Record<string, unknown>[]) {
    push(row.label || row.type || row.description, row.value_mm || row.value);
  }

  // Evidence/notes often contain an overall size even when the extractor did not
  // normalize it into a dimensions row (for example: "SIZE 450 x 300").
  const textSources = [
    ...(data.notes || []),
    ...(data.evidence || []).flatMap((row) => [row.field, row.value, row.basis])
  ].map((item) => String(item || ""));

  for (const source of textSources) {
    const pair = source.match(/(?:overall|size|blank|plate|sheet|width|height|w\s*[x×]\s*h)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i);
    if (pair) {
      push("overall width", pair[1]);
      push("overall height", pair[2]);
    }
  }

  const width = labelled.find((row) => /(^|\b)(width|overall\s*width|w)(\b|$)/i.test(row.label))?.value || 0;
  const height = labelled.find((row) => /(^|\b)(height|overall\s*height|h)(\b|$)/i.test(row.label))?.value || 0;
  const length = labelled.find((row) => /(^|\b)(length|overall|oal|long)(\b|$)/i.test(row.label))?.value || 0;

  const physical = labelled
    .filter((row) => !/diam|radius|hole|thread|chamfer|angle|pitch|thick|thk|wall|gauge/i.test(row.label))
    .map((row) => row.value)
    .filter((value) => value > 0)
    .sort((a, b) => b - a);

  const cad = data.cad_geometry?.dimensions_mm || {};
  const cadAxes = [Number(cad.x || 0), Number(cad.y || 0), Number(cad.z || 0)]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a);

  const first = width || length || physical[0] || cadAxes[0] || 0;
  const second = height || (physical.find((value) => Math.abs(value - first) > 0.001) || 0) || cadAxes[1] || 0;

  if (!(first > 0 && second > 0)) return null;
  return {
    widthMm: Math.max(first, second),
    heightMm: Math.min(first, second),
    basis: width > 0 && height > 0
      ? "Drawing overall width × height"
      : cadAxes.length >= 2 && !(physical.length >= 2)
        ? "CAD overall width × height"
        : "Two largest usable drawing dimensions interpreted as width × height"
  };
}


function engineeringMetricOrDash(value: unknown, digits: number, unit: string) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? `${numeric.toFixed(digits)} ${unit}` : "—";
}

function engineeringLengthToMm(value: unknown, unit: unknown = "mm") {
  const numeric = Number(value || 0);
  if (!(Number.isFinite(numeric) && numeric > 0)) return 0;
  const normalized = String(unit || "mm").trim().toLowerCase().replace(/\s+/g, "");
  if (["in", "inch", "inches", '"'].includes(normalized)) return numeric * 25.4;
  if (["ft", "foot", "feet", "'"].includes(normalized)) return numeric * 304.8;
  if (["cm", "centimeter", "centimeters", "centimetre", "centimetres"].includes(normalized)) return numeric * 10;
  if (["m", "meter", "meters", "metre", "metres"].includes(normalized)) return numeric * 1000;
  return numeric;
}

function normalizedDimensionMm(row: any) {
  const originalUnit = row?.original_unit || row?.unit || row?.units || "mm";
  const originalValue = row?.original_value ?? row?.value ?? row?.value_mm;
  // New extraction stores value_mm already normalized. When original_value/unit are
  // present, recompute deterministically so inch/foot callouts never enter costing as mm.
  if (row?.original_value != null || (row?.unit && String(row.unit).toLowerCase() !== "mm")) {
    return engineeringLengthToMm(originalValue, originalUnit);
  }
  const normalizedValue = Number(row?.value_mm ?? row?.value ?? 0);
  return Number.isFinite(normalizedValue) && normalizedValue > 0 ? normalizedValue : 0;
}

function predictedPartWeight(data: AIExtraction | null | undefined, drawing: DrawingDetails) {
  if (!data) return null;

  const quantity = Math.max(1, Number(data.product_quantity || drawing.quantity || 1));
  const weightMeta = data as AIExtraction & {
    drawing_stated_weight_kg?: number;
    weight_source?: string;
  };
  const statedWeightKg = Number(weightMeta.drawing_stated_weight_kg || 0);
  const hasAuthoritativeDrawingWeight = statedWeightKg > 0 && String(weightMeta.weight_source || "drawing_stated") === "drawing_stated";
  if (hasAuthoritativeDrawingWeight) {
    const base = statedWeightKg * quantity;
    return {
      baseWeightKg: base,
      totalWeightKg: base + 1,
      basis: "Drawing-stated weight × quantity; 1 kg costing allowance kept separate",
      source: "drawing_stated" as const
    };
  }

  const storedPrediction = data.weight_prediction;
  // Never reuse a historical geometry prediction as source truth. Older drafts
  // can contain values calculated before the current extraction rules. Only a
  // prediction explicitly tagged drawing_stated may bypass recalculation.
  if (String((storedPrediction as { source?: string } | undefined)?.source || "") === "drawing_stated"
      && Number(storedPrediction?.base_weight_kg || 0) > 0) {
    const base = Number(storedPrediction?.base_weight_kg || 0);
    return {
      baseWeightKg: base,
      totalWeightKg: base + 1,
      basis: String(storedPrediction?.basis || "Drawing-stated weight + 1 kg costing allowance"),
      source: "drawing_stated" as const
    };
  }
  const materialText = [
    data.material?.family,
    data.material?.grade,
    data.material?.specification,
    drawing.material
  ].filter(Boolean).join(" ");
  const recognizedDensity = recognizedMaterialDensityKgM3(materialText);
  const density = recognizedDensity > 0 ? recognizedDensity : 7850;
  const densityBasis = recognizedDensity > 0 ? "material density" : "default steel density 7850 kg/m³";
  // Never reinterpret raw weight_kg as a printed value once the record already
  // contains a prediction. New extraction marks true title-block weights using
  // drawing_stated_weight_kg/weight_source before this function runs.
  const explicitWeight = !data.weight_prediction && String(weightMeta.weight_source || "") === "drawing_stated"
    ? Number(data.weight_kg || 0)
    : 0;

  if (explicitWeight > 0) {
    const base = explicitWeight * quantity;
    return {
      baseWeightKg: base,
      totalWeightKg: base + 1,
      basis: "Drawing-stated weight × quantity; 1 kg costing allowance kept separate",
      source: "drawing_stated" as const
    };
  }

  const cadVolume = Number(data.cad_geometry?.volume_mm3 || 0);
  if (cadVolume > 0) {
    const base = cadVolume * density / 1_000_000_000 * quantity;
    if (base > 0) return {
      baseWeightKg: base,
      totalWeightKg: base + 1,
      basis: `CAD solid volume × ${densityBasis} × quantity + 1 kg allowance`
    };
  }

  const assemblyParts = (data.assembly_parts || []) as Record<string, unknown>[];
  if (assemblyParts.length) {
    let assemblyWeight = 0;
    let derivedParts = 0;
    for (const part of assemblyParts) {
      const partMaterial = String(part.material || materialText);
      const recognizedPartDensity = recognizedMaterialDensityKgM3(partMaterial);
      const partDensity = recognizedPartDensity > 0 ? recognizedPartDensity : density;
      const length = numericFeatureValue(part, "length_mm");
      const width = numericFeatureValue(part, "width_mm");
      const height = numericFeatureValue(part, "height_mm");
      const thickness = numericFeatureValue(part, "thickness_mm");
      const partQty = Math.max(1, Number(part.quantity || 1));
      if (!(length > 0 && width > 0)) continue;
      const third = thickness > 0 ? thickness : (height > 0 ? height : DEFAULT_FALLBACK_THICKNESS_MM);
      if (!(third > 0)) continue;
      assemblyWeight += length * width * third * partDensity / 1_000_000_000 * partQty;
      derivedParts += 1;
    }
    if (assemblyWeight > 0 && derivedParts > 0) return {
      baseWeightKg: assemblyWeight,
      totalWeightKg: assemblyWeight + 1,
      basis: `${derivedParts} assembly component${derivedParts === 1 ? "" : "s"} × material density + 1 kg allowance`
    };
  }

  const dimensions = ((data.dimensions || []) as Record<string, unknown>[])
    .map((row) => ({
      label: String(row.label || row.type || "").toLowerCase(),
      value: normalizedDimensionMm(row)
    }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0);
  const thickness = Number(data.thickness_mm || drawing.thickness_mm || 0);
  const form = String(data.part_form || "").toLowerCase();

  const byLabel = (keys: string[]) => dimensions.find((row) => keys.some((key) => row.label.includes(key)))?.value || 0;
  const overall = dimensions
    .filter((row) => row.value > Math.max(0, thickness * 1.01))
    .map((row) => row.value)
    .sort((a, b) => b - a);

  let volumeMm3 = 0;
  let basis = "";

  if (form.includes("shaft") || form.includes("cylind") || form.includes("round")) {
    const diameter = byLabel(["diameter", "dia", "od", "ø"]);
    const length = byLabel(["length", "overall", "oal"]) || overall[0] || 0;
    if (diameter > 0 && length > 0) {
      volumeMm3 = Math.PI * diameter * diameter / 4 * length;
      basis = `Cylindrical drawing geometry × ${densityBasis} × quantity + 1 kg allowance`;
    }
  } else if (form.includes("tube") || form.includes("pipe")) {
    const od = byLabel(["outer diameter", "od", "outside dia"]);
    const id = byLabel(["inner diameter", "id", "inside dia"]);
    const length = byLabel(["length", "overall", "oal"]) || overall[0] || 0;
    if (od > 0 && id > 0 && od > id && length > 0) {
      volumeMm3 = Math.PI * (od * od - id * id) / 4 * length;
      basis = `Pipe/tube drawing geometry × ${densityBasis} × quantity + 1 kg allowance`;
    }
  } else if (thickness > 0 && overall.length >= 2) {
    volumeMm3 = overall[0] * overall[1] * thickness;
    basis = `Plate/sheet envelope × thickness × ${densityBasis} × quantity + 1 kg allowance`;
  } else if ((form.includes("block") || form.includes("prismatic")) && overall.length >= 3) {
    volumeMm3 = overall[0] * overall[1] * overall[2];
    basis = `Prismatic envelope × ${densityBasis} × quantity + 1 kg allowance`;
  }

  if (!(volumeMm3 > 0)) {
    const geometry = data.cad_geometry?.dimensions_mm || {};
    const axes = [Number(geometry.x || 0), Number(geometry.y || 0), Number(geometry.z || 0)]
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => b - a);
    if (axes.length >= 2 && thickness > 0) {
      volumeMm3 = axes[0] * axes[1] * thickness;
      basis = `CAD/drawing envelope × normalized thickness × ${densityBasis} × quantity + 1 kg allowance`;
    }
  }

  if (!(volumeMm3 > 0)) {
    const envelope = parsedEngineeringEnvelopeMm(data);
    const normalizedThickness = thickness > 0 ? thickness : DEFAULT_FALLBACK_THICKNESS_MM;
    if (envelope && normalizedThickness > 0) {
      volumeMm3 = envelope.widthMm * envelope.heightMm * normalizedThickness;
      basis = `${envelope.basis} × ${normalizedThickness.toFixed(3)} mm thickness × ${densityBasis} × quantity + 1 kg allowance`;
    }
  }

  if (!(volumeMm3 > 0)) return null;
  const base = volumeMm3 * density / 1_000_000_000 * quantity;
  if (!(base > 0)) return null;
  return { baseWeightKg: base, totalWeightKg: base + 1, basis };
}

function enrichPartSummary(result: AnalysisResponse): AnalysisResponse {
  const raw: AIExtraction = { ...(result.ai_raw || {}) };

  // Source-truth cleanup for old drafts/reviews. A previous build wrote the
  // internal 100 mm costing fallback into the visible drawing thickness field.
  // Clear that stale value unless the drawing actually supplies thickness
  // evidence/dimension support.
  const thicknessEvidenceText = [
    ...(raw.notes || []),
    ...(raw.evidence || []).flatMap((row) => [row.field, row.value, row.basis]),
    ...((raw.dimensions || []) as Record<string, unknown>[]).flatMap((row) => [row.label, row.type, row.callout, row.source])
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  const staleDefaultThickness = Number(raw.thickness_mm || result.drawing?.thickness_mm || 0) === DEFAULT_FALLBACK_THICKNESS_MM
    && (/default thickness|fallback thickness/.test(thicknessEvidenceText)
      || !/(thickness|thick|thk|wall|gauge|plate\s*t|sheet\s*t)/i.test(thicknessEvidenceText));
  if (staleDefaultThickness) {
    raw.thickness_mm = undefined;
    raw.notes = (raw.notes || []).filter((note) => !/^Default thickness:/i.test(String(note)));
  }

  const material = { ...(raw.material || {}) };
  const drawingMaterial = String(result.drawing?.material || "").trim();

  if (!String(material.family || "").trim() && drawingMaterial && drawingMaterial.toLowerCase() !== "not detected") {
    material.family = drawingMaterial;
  }

  const thicknessPrediction = predictedThickness({ ...raw, material }, result.drawing);
  if (!(Number(raw.thickness_mm || 0) > 0) && thicknessPrediction) {
    raw.thickness_mm = Number(thicknessPrediction.value.toFixed(3));
    const thicknessNote = thicknessPrediction.isFallback
      ? `Default thickness: ${Number(thicknessPrediction.value.toFixed(3))} mm (${thicknessPrediction.basis}).`
      : `Predicted thickness: ${Number(thicknessPrediction.value.toFixed(3))} mm (${thicknessPrediction.basis}).`;
    raw.notes = Array.from(new Set([
      ...(raw.notes || []).map((item) => String(item)),
      thicknessNote
    ]));
  }

  // Normalize the main overall measurements into the editable Dimensions table as well.
  // This keeps Drawing Review, Part Summary, Material Calculator and quotation views
  // on one source of truth instead of showing calculated values in only one screen.
  const normalizedDimensions = [...((raw.dimensions || []) as Record<string, unknown>[])];
  const hasDimensionLabel = (pattern: RegExp) => normalizedDimensions.some((row) =>
    pattern.test(String(row.label || row.type || row.description || "").toLowerCase())
    && normalizedDimensionMm(row) > 0
  );
  const addDerivedDimension = (label: string, value: number, basis: string) => {
    if (!(Number.isFinite(value) && value > 0)) return;
    normalizedDimensions.push({
      label,
      value_mm: Number(value.toFixed(3)),
      tolerance: "",
      quantity: 1,
      confidence: 65,
      source: basis
    });
  };

  const envelope = parsedEngineeringEnvelopeMm({ ...raw, material });
  const cadSize = raw.cad_geometry?.dimensions_mm || {};
  const cadAxes = [Number(cadSize.x || 0), Number(cadSize.y || 0), Number(cadSize.z || 0)]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a);
  const normalizedWidth = Number(envelope?.widthMm || cadAxes[0] || 0);
  const normalizedHeight = Number(envelope?.heightMm || cadAxes[1] || 0);

  if (!hasDimensionLabel(/(^|\b)(width|overall\s*width|w)(\b|$)/i)) {
    addDerivedDimension("Overall Width", normalizedWidth, envelope?.basis || "CAD/drawing envelope");
  }
  if (!hasDimensionLabel(/(^|\b)(height|overall\s*height|h)(\b|$)/i)) {
    addDerivedDimension("Overall Height", normalizedHeight, envelope?.basis || "CAD/drawing envelope");
  }
  if (!hasDimensionLabel(/thickness|thick|thk|plate\s*t|sheet\s*t|wall|gauge/i) && Number(raw.thickness_mm || 0) > 0) {
    addDerivedDimension("Thickness", Number(raw.thickness_mm), thicknessPrediction?.basis || "Normalized product thickness");
  }
  raw.dimensions = normalizedDimensions;

  const weightMeta = raw as AIExtraction & {
    drawing_stated_weight_kg?: number;
    weight_source?: string;
  };
  // Authoritative drawing weight must be explicitly tagged by the backend.
  // Never promote an untagged AI/calculated number into a printed drawing value.

  const prediction = predictedPartWeight({ ...raw, material }, result.drawing);
  if (prediction) {
    const authoritative = String((prediction as { source?: string }).source || "") === "drawing_stated";
    // Keep Drawing Review / Part Summary on the true engineering weight.
    // Allowance belongs only to costing and must not contaminate the drawing value.
    raw.weight_kg = authoritative && Number(weightMeta.drawing_stated_weight_kg || 0) > 0
      ? Number(Number(weightMeta.drawing_stated_weight_kg).toFixed(3))
      : Number(prediction.baseWeightKg.toFixed(3));
    raw.weight_prediction = {
      base_weight_kg: Number(prediction.baseWeightKg.toFixed(3)),
      allowance_kg: 1,
      total_weight_kg: Number(prediction.totalWeightKg.toFixed(3)),
      basis: prediction.basis,
      source: authoritative ? "drawing_stated" : "geometry_prediction"
    } as typeof raw.weight_prediction;
  }

  const hasMaterial = Boolean(String(material.family || material.grade || material.specification || drawingMaterial || "").trim());
  const hasThickness = Number(raw.thickness_mm || 0) > 0;
  const hasWeight = Number(raw.weight_kg || 0) > 0;
  const missing = (raw.missing_or_uncertain || []).map((item) => String(item));
  raw.missing_or_uncertain = missing.filter((item) => {
    const lower = item.toLowerCase();
    if (hasThickness && /thick|thk|sheet gauge/.test(lower)) return false;
    if (hasWeight && /weight|mass|kg/.test(lower)) return false;
    if (hasMaterial && /material/.test(lower)) return false;
    return true;
  });

  if (!hasMaterial) raw.missing_or_uncertain.push("Material family/grade is required to calculate product weight accurately.");
  if (!hasThickness) raw.missing_or_uncertain.push("Thickness could not be derived from the drawing; confirm the section/stock thickness.");
  if (!hasWeight) raw.missing_or_uncertain.push("Weight could not be calculated until usable geometry, thickness and material density are available.");
  raw.missing_or_uncertain = Array.from(new Set(raw.missing_or_uncertain));

  raw.confidence = {
    ...(raw.confidence || {}),
    thickness: hasThickness ? Math.max(Number(raw.confidence?.thickness || 0), thicknessPrediction?.isFallback ? 45 : thicknessPrediction ? 70 : 0) : Number(raw.confidence?.thickness || 0),
    weight: hasWeight ? Math.max(Number(raw.confidence?.weight || 0), prediction ? 75 : 0) : Number(raw.confidence?.weight || 0)
  };

  if (raw.engineering_intelligence?.completeness) {
    const reviewRequired = (raw.engineering_intelligence.completeness.review_required || []).filter((item) => {
      const lower = String(item).toLowerCase();
      if (hasThickness && /thick|thk|sheet gauge/.test(lower)) return false;
      if (hasWeight && /weight|mass|kg/.test(lower)) return false;
      if (hasMaterial && /material/.test(lower)) return false;
      return true;
    });
    raw.engineering_intelligence = {
      ...raw.engineering_intelligence,
      completeness: {
        ...raw.engineering_intelligence.completeness,
        review_required: reviewRequired
      }
    };
  }

  const quantityConfidence = Number(raw.confidence?.quantity || 0);
  if (quantityConfidence <= 0 && Number(raw.product_quantity || 0) === 1) {
    raw.product_quantity = undefined;
  }

  const nextDrawing = {
    ...result.drawing,
    material: [material.family, material.grade, material.specification].filter(Boolean).join(" ") || result.drawing.material,
    thickness_mm: raw.thickness_mm == null ? (staleDefaultThickness ? 0 : result.drawing.thickness_mm) : Number(raw.thickness_mm),
    weight_kg: raw.weight_kg == null ? result.drawing.weight_kg : Number(raw.weight_kg)
  };

  const costingWeightKg = Number(raw.weight_prediction?.total_weight_kg || raw.weight_kg || 0);
  const drawingWeightSource = String((raw.weight_prediction as { source?: string } | undefined)?.source || "") === "drawing_stated";
  let materialApplied = false;
  let nextRows = result.rows.map((row) => {
    if (materialApplied || String(row.category || "").toUpperCase() !== "MATERIAL" || !(costingWeightKg > 0)) return row;
    materialApplied = true;
    const costingQty = Number(costingWeightKg.toFixed(4));
    const rate = Number(row.rate || 0);
    return {
      ...row,
      item: String(row.item || "").trim() || nextDrawing.material || "Material",
      drawingQty: raw.weight_prediction
        ? `${drawingWeightSource ? "Drawing weight" : "Predicted"}: ${Number(raw.weight_prediction.base_weight_kg || 0).toFixed(3)} kg + 1 kg allowance`
        : row.drawingQty,
      costingQty,
      unit: "kg",
      cost: costingQty * rate,
      rateSource: rate > 0 ? `${row.rateSource || "Rate Master"} · ${drawingWeightSource ? "Drawing-stated weight" : "Predicted weight"}` : row.rateSource
    };
  });

  if (!materialApplied && costingWeightKg > 0) {
    nextRows = [{
      id: `auto-material-${result.file_hash || Date.now()}`,
      category: "MATERIAL",
      item: nextDrawing.material || "Material",
      drawingQty: raw.weight_prediction
        ? `${drawingWeightSource ? "Drawing weight" : "Predicted"}: ${Number(raw.weight_prediction.base_weight_kg || 0).toFixed(3)} kg + 1 kg allowance`
        : `${Number(raw.weight_kg).toFixed(3)} kg`,
      costingQty: Number(costingWeightKg.toFixed(4)),
      unit: "kg",
      rate: 0,
      cost: 0,
      confidence: drawingWeightSource ? "Exact" : "Estimated",
      rateId: null,
      rateSource: drawingWeightSource ? "Drawing-stated weight · rate required" : "Drawing prediction · rate required",
      criticalScore: 100
    }, ...nextRows];
  }

  return { ...result, ai_raw: { ...raw, material }, drawing: nextDrawing, rows: nextRows, summary: undefined };
}

function materialCalculatorErrors(value: MaterialCalculatorState) {
  const errors: string[] = [];
  // A trusted drawing-stated/predicted base weight can be costed directly.
  // Do not force fake geometry/thickness just to satisfy the calculator UI.
  if (value.predictedBaseWeightKg > 0 || value.predictedTotalWeightKg > 0) {
    if (!(value.quantity > 0)) errors.push("Quantity");
    if (!(value.densityKgM3 > 0)) errors.push("Material density");
    if (!(value.pricePerKg > 0)) errors.push("Price per kg");
    return errors;
  }
  if (!(value.quantity > 0)) errors.push("Product quantity");
  if (!(value.densityKgM3 > 0)) errors.push("Material density");
  if (!(value.pricePerKg > 0)) errors.push("Material price per kg");
  if (!Number.isFinite(value.allowanceKg) || value.allowanceKg < 0) errors.push("Valid allowance");
  if (value.predictedBaseWeightKg > 0 || value.predictedTotalWeightKg > 0) return errors;
  if (!(value.lengthMm > 0)) errors.push("Length");

  if (value.shape === "plate") {
    if (!(value.widthMm > 0)) errors.push("Width");
    if (!(value.thicknessMm > 0)) errors.push("Thickness");
  } else if (value.shape === "round_bar") {
    if (!(value.diameterMm > 0)) errors.push("Diameter");
  } else if (value.shape === "pipe") {
    if (!(value.outerDiameterMm > 0)) errors.push("Outer diameter");
    if (!(value.innerDiameterMm > 0) || value.innerDiameterMm >= value.outerDiameterMm) errors.push("Valid inner diameter");
  } else if (value.shape === "rect_tube") {
    if (!(value.widthMm > 0)) errors.push("Width");
    if (!(value.heightMm > 0)) errors.push("Height");
    if (!(value.wallThicknessMm > 0) || value.wallThicknessMm * 2 >= Math.min(value.widthMm || 0, value.heightMm || 0)) errors.push("Valid wall thickness");
  } else {
    if (!(value.legAMm > 0)) errors.push("Leg A");
    if (!(value.legBMm > 0)) errors.push("Leg B");
    if (!(value.thicknessMm > 0) || value.thicknessMm >= Math.min(value.legAMm || 0, value.legBMm || 0)) errors.push("Valid thickness");
  }

  return errors;
}

type PersistedWorkflowDraft = {
  view: View;
  step: number;
  file: File | null;
  files: File[];
  batchItems: BatchWorkspace[];
  activeBatchId: string;
  quoteMode: BatchQuoteMode;
  analysis: AnalysisResponse | null;
  drawing: DrawingDetails | null;
  rows: CostRow[];
  summary: QuoteSummary;
  finalPriceOverride: number | null;
  commercialAmountOverrides: CommercialAmountOverrides;
  customer: string;
  modelFile?: File | null;
  sourceFiles?: File[];
  activeSourceKey?: string;
  datasetId: string;
  datasetName: string;
  batchFailures?: BatchFailure[];
  dfmReports?: DfmReport[];
  bomReports?: BomReport[];
  selectedDfmId?: string;
  selectedBomId?: string;
  savedAt: string;
};

type WorkspaceDatasetSummary = {
  datasetId: string;
  datasetName: string;
  savedAt: string;
  step: number;
  view: View;
  drawingNo: string;
  fileCount: number;
  hasDfm: boolean;
  hasBom: boolean;
};

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ACTIVE_DRAFT_DB, 2);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ACTIVE_DRAFT_STORE)) {
        db.createObjectStore(ACTIVE_DRAFT_STORE);
      }
      if (!db.objectStoreNames.contains(WORKSPACE_DATASET_STORE)) {
        db.createObjectStore(WORKSPACE_DATASET_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveWorkflowDraft(value: PersistedWorkflowDraft) {
  const db = await openDraftDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_DRAFT_STORE, "readwrite");
    tx.objectStore(ACTIVE_DRAFT_STORE).put(value, ACTIVE_DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

async function loadWorkflowDraft(): Promise<PersistedWorkflowDraft | null> {
  const db = await openDraftDatabase();

  const value = await new Promise<PersistedWorkflowDraft | null>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_DRAFT_STORE, "readonly");
    const request = tx.objectStore(ACTIVE_DRAFT_STORE).get(ACTIVE_DRAFT_KEY);
    request.onsuccess = () => resolve((request.result as PersistedWorkflowDraft) || null);
    request.onerror = () => reject(request.error);
  });

  db.close();
  return value;
}

async function clearWorkflowDraft() {
  const db = await openDraftDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_DRAFT_STORE, "readwrite");
    tx.objectStore(ACTIVE_DRAFT_STORE).delete(ACTIVE_DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}


async function saveWorkspaceDataset(value: PersistedWorkflowDraft) {
  if (!value.datasetId) return;
  const db = await openDraftDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_DATASET_STORE, "readwrite");
    tx.objectStore(WORKSPACE_DATASET_STORE).put(value, value.datasetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

async function loadWorkspaceDataset(datasetId: string): Promise<PersistedWorkflowDraft | null> {
  if (!datasetId) return null;
  const db = await openDraftDatabase();

  const value = await new Promise<PersistedWorkflowDraft | null>((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_DATASET_STORE, "readonly");
    const request = tx.objectStore(WORKSPACE_DATASET_STORE).get(datasetId);
    request.onsuccess = () => resolve((request.result as PersistedWorkflowDraft) || null);
    request.onerror = () => reject(request.error);
  });

  db.close();
  return value;
}

async function loadLatestWorkspaceDataset(): Promise<PersistedWorkflowDraft | null> {
  const db = await openDraftDatabase();

  const values = await new Promise<PersistedWorkflowDraft[]>((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_DATASET_STORE, "readonly");
    const request = tx.objectStore(WORKSPACE_DATASET_STORE).getAll();
    request.onsuccess = () => resolve((request.result as PersistedWorkflowDraft[]) || []);
    request.onerror = () => reject(request.error);
  });

  db.close();

  const sorted = values
    .filter((item) => item?.datasetId)
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));

  return sorted.find((item) =>
    Boolean(
      item.analysis
      || item.drawing
      || item.file
      || item.files?.length
      || item.sourceFiles?.length
      || item.batchItems?.length
    )
  ) || sorted[0] || null;
}

async function listWorkspaceDatasetSummaries(): Promise<WorkspaceDatasetSummary[]> {
  const db = await openDraftDatabase();

  const values = await new Promise<PersistedWorkflowDraft[]>((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_DATASET_STORE, "readonly");
    const request = tx.objectStore(WORKSPACE_DATASET_STORE).getAll();
    request.onsuccess = () => resolve((request.result as PersistedWorkflowDraft[]) || []);
    request.onerror = () => reject(request.error);
  });

  db.close();

  return values
    .filter((item) => item?.datasetId)
    .map((item) => ({
      datasetId: item.datasetId,
      datasetName: item.datasetName || "Quotation Dataset",
      savedAt: item.savedAt || "",
      step: item.step || 1,
      view: item.view || "workflow",
      drawingNo: item.drawing?.drawing_no || item.analysis?.drawing?.drawing_no || "",
      fileCount: item.files?.length || (item.file ? 1 : 0),
      hasDfm: Boolean(item.dfmReports?.length),
      hasBom: Boolean(item.bomReports?.length)
    }))
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
}

async function deleteWorkspaceDataset(datasetId: string) {
  const db = await openDraftDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_DATASET_STORE, "readwrite");
    tx.objectStore(WORKSPACE_DATASET_STORE).delete(datasetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

function findAutomaticMaterialRate(rates: RateItem[], materialName: string) {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = clean(materialName);
  if (!target) return null;

  const candidates = rates.filter((rate) => rate.active && rate.category === "MATERIAL" && Number(rate.price || 0) > 0);
  const exact = candidates.find((rate) => clean(rateChoiceLabel(rate)) === target || clean(rate.name) === target);
  if (exact) return exact;

  return candidates
    .map((rate) => {
      const label = clean(`${rate.name || ""} ${rate.grade || ""}`);
      const targetTokens = new Set(target.split(" ").filter((token) => token.length > 1));
      const labelTokens = new Set(label.split(" ").filter((token) => token.length > 1));
      let score = 0;
      targetTokens.forEach((token) => { if (labelTokens.has(token)) score += 1; });
      return { rate, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.rate || null;
}

export default function Page() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [view, setView] = useState<View>("dashboard");
  const [sideOpen, setSideOpen] = useState(true);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [batchItems, setBatchItems] = useState<BatchWorkspace[]>([]);
  const batchItemsRef = useRef<BatchWorkspace[]>([]);
  // Invalidates asynchronous DFM/BOM callbacks from a quotation that has been ended.
  const artifactLifecycleRef = useRef(0);
  const [batchFailures, setBatchFailures] = useState<BatchFailure[]>([]);
  const [activeBatchId, setActiveBatchId] = useState("");
  const [quoteMode, setQuoteMode] = useState<BatchQuoteMode>("merge");
  const [analyzeProgress, setAnalyzeProgress] = useState("");
  const [trainingPromptItems, setTrainingPromptItems] = useState<BatchWorkspace[]>([]);
  const [trainingBusy, setTrainingBusy] = useState(false);

  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [drawing, setDrawing] = useState<DrawingDetails | null>(null);
  const [rows, setRows] = useState<CostRow[]>([]);
  const [summary, setSummary] = useState<QuoteSummary>(emptySummary);
  const [finalPriceOverride, setFinalPriceOverride] = useState<number | null>(null);
  const [commercialAmountOverrides, setCommercialAmountOverrides] = useState<CommercialAmountOverrides>({
    material_wastage: null,
    overhead: null,
    markup: null
  });
  const [customer, setCustomer] = useState("Sample Customer");
  const [dfmReports, setDfmReports] = useState<DfmReport[]>([]);
  const [bomReports, setBomReports] = useState<BomReport[]>([]);
  const [dfmJobs, setDfmJobs] = useState<Record<string, ArtifactJobState>>({});
  const [bomJobs, setBomJobs] = useState<Record<string, ArtifactJobState>>({});
  const [selectedDfmId, setSelectedDfmId] = useState("");
  const [selectedBomId, setSelectedBomId] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [activeSourceKey, setActiveSourceKey] = useState("");
  const [showDfmHistory, setShowDfmHistory] = useState(false);
  const [showBomHistory, setShowBomHistory] = useState(false);
  const [workspaceDatasetId, setWorkspaceDatasetId] = useState(() => createWorkspaceDatasetId());
  const [workspaceDatasetName, setWorkspaceDatasetName] = useState("Untitled Quotation Dataset");
  const [workspaceDatasets, setWorkspaceDatasets] = useState<WorkspaceDatasetSummary[]>([]);
  const [uploadedFileStatus, setUploadedFileStatus] = useState<Record<string, "uploading" | "uploaded" | "failed">>({});
  const [draftHydrated, setDraftHydrated] = useState(false);
  const historyReadyRef = useRef(false);
  const restoringHistoryRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("Ready.");
  const [fileUrl, setFileUrl] = useState("");
  const [revisionComparison, setRevisionComparison] = useState<RevisionComparison | null>(null);
  const [premiumEstimate, setPremiumEstimate] = useState<PremiumEstimate | null>(null);
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [premiumKpis, setPremiumKpis] = useState<{ quotes: number; total_value: number; won: number; win_rate: number; actual_samples: number; approval_events: number } | null>(null);
  const [actualCostDraft, setActualCostDraft] = useState({ actualCost: 0, actualHours: 0, notes: "" });
  const [estimatorQuestion, setEstimatorQuestion] = useState("");
  const [estimatorAnswer, setEstimatorAnswer] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("dfab-ui-theme");
      const initialTheme = saved === "dark" || saved === "light"
        ? saved
        : (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      setTheme(initialTheme);
      document.documentElement.dataset.theme = initialTheme;
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("dfab-ui-theme", theme); } catch {}
  }, [theme]);

  // Re-normalize engineering values whenever a drawing workspace becomes active.
  // This also upgrades older saved workspaces that were analyzed before automatic
  // thickness/weight prediction was introduced.
  useEffect(() => {
    if (!analysis || !drawing) return;

    const normalized = enrichPartSummary({
      ...analysis,
      drawing,
      rows
    });

    const beforeThickness = Number(analysis.ai_raw?.thickness_mm || drawing.thickness_mm || 0);
    const afterThickness = Number(normalized.ai_raw?.thickness_mm || normalized.drawing.thickness_mm || 0);
    const beforeWeight = Number(analysis.ai_raw?.weight_kg || drawing.weight_kg || 0);
    const afterWeight = Number(normalized.ai_raw?.weight_kg || normalized.drawing.weight_kg || 0);
    const currentMaterial = rows.find((row) => String(row.category || "").toUpperCase() === "MATERIAL");
    const normalizedMaterial = normalized.rows.find((row) => String(row.category || "").toUpperCase() === "MATERIAL");
    const materialChanged = Number(currentMaterial?.costingQty || 0) !== Number(normalizedMaterial?.costingQty || 0);

    if (beforeThickness === afterThickness && beforeWeight === afterWeight && !materialChanged) return;

    setAnalysis(normalized);
    setDrawing(normalized.drawing);
    setRows(normalized.rows);
    void api.calculateQuote(normalized.rows).then(setSummary).catch(() => undefined);
  }, [analysis?.file_hash, activeBatchId]);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [rates, setRates] = useState<RateItem[]>([]);
  const [catalog, setCatalog] = useState<RateCatalog | null>(null);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);

  const [rateTab, setRateTab] = useState<RateTab>("MATERIAL");
  const [rateSearch, setRateSearch] = useState("");
  const [showAddRate, setShowAddRate] = useState(false);
  const [draftRate, setDraftRate] = useState<RateItem>(blankRate());
  const [customGrade, setCustomGrade] = useState("");
  const [customRateField, setCustomRateField] = useState<"material" | "process" | "labour" | "other" | "unit" | null>(null);
  const [customRateValue, setCustomRateValue] = useState("");
  const [showMaterialCalculator, setShowMaterialCalculator] = useState(false);
  const [materialCalculator, setMaterialCalculator] = useState<MaterialCalculatorState>(EMPTY_MATERIAL_CALCULATOR);
  const [materialCalculatorMissing, setMaterialCalculatorMissing] = useState<string[]>([]);

  const mediumCritical = settings?.critical_medium_threshold ?? 40;
  const highCritical = settings?.critical_high_threshold ?? 70;

  const chargeTotals = useMemo(() => {
    return rows.reduce(
      (totals, row) => {
        const value = Math.max(0, Number(row.costingQty || 0)) * Math.max(0, Number(row.rate || 0));
        const category = String(row.category || "").toUpperCase();

        if (category === "MATERIAL") totals.material += value;
        else if (category === "PROCESS") totals.process += value;
        else if (category === "LABOUR") totals.labour += value;

        return totals;
      },
      { material: 0, process: 0, labour: 0 }
    );
  }, [rows]);

  // Auto-apply the best saved material rate as soon as drawing-derived weight is available.
  useEffect(() => {
    if (!drawing || !rows.length || !rates.length) return;
    const materialIndex = rows.findIndex((row) => String(row.category || "").toUpperCase() === "MATERIAL");
    if (materialIndex < 0) return;
    const current = rows[materialIndex];
    if (Number(current.rate || 0) > 0 || Number(current.costingQty || 0) <= 0) return;

    const materialName = String(current.item || drawing.material || analysis?.ai_raw?.material?.family || "").trim();
    const matched = findAutomaticMaterialRate(rates, materialName);
    if (!matched) return;

    const nextRows = rows.map((row, index) => index === materialIndex ? {
      ...row,
      item: row.item || rateChoiceLabel(matched),
      rate: Number(matched.price || 0),
      rateId: matched.id,
      cost: Number(row.costingQty || 0) * Number(matched.price || 0),
      rateSource: "Rate Master · Auto matched material"
    } : row);
    setRows(nextRows);
    void api.calculateQuote(nextRows).then(setSummary).catch(() => undefined);
  }, [analysis?.file_hash, drawing?.material, rates, rows]);

  const criticalName = (score: number) => criticalLabel(score, mediumCritical, highCritical);

  const refresh = useCallback(async () => {
    // Load each resource independently. A slow/failed dataset/history endpoint
    // must never prevent Rate Master or settings from rendering.
    const results = await Promise.allSettled([
      api.getSettings(),
      api.getRates(),
      api.getRateCatalog(),
      api.getDatasetStats(),
      api.getQuotes()
    ]);

    if (results[0].status === "fulfilled") setSettings(results[0].value);
    if (results[1].status === "fulfilled") setRates(results[1].value);
    if (results[2].status === "fulfilled") setCatalog(results[2].value);
    if (results[3].status === "fulfilled") setStats(results[3].value);
    if (results[4].status === "fulfilled") setQuotes(results[4].value);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);


  // Use DFAB's website icon as both the sidebar brand source and browser tab icon.
  useEffect(() => {
    window.onbeforeunload = null;
    document.title = "DFAB AI Quotation";

    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = "/dfab-logo.png";

    let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!apple) {
      apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      document.head.appendChild(apple);
    }
    apple.href = "/dfab-logo.png";
  }, []);

  const refreshWorkspaceDatasets = useCallback(async () => {
    try {
      setWorkspaceDatasets(await listWorkspaceDatasetSummaries());
    } catch {
      setWorkspaceDatasets([]);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaceDatasets();
  }, [refreshWorkspaceDatasets]);

  useEffect(() => {
    try {
      const savedDfm = JSON.parse(localStorage.getItem(DFM_HISTORY_KEY) || "[]") as DfmReport[];
      const savedBom = JSON.parse(localStorage.getItem(BOM_HISTORY_KEY) || "[]") as BomReport[];
      setDfmReports(savedDfm);
      setBomReports(savedBom);
      setSelectedDfmId(savedDfm.at(-1)?.id || "");
      setSelectedBomId(savedBom.at(-1)?.id || "");
    } catch {}
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(DFM_HISTORY_KEY, JSON.stringify(dfmReports)); } catch {}
    }, 600);
    return () => window.clearTimeout(timer);
  }, [dfmReports]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(BOM_HISTORY_KEY, JSON.stringify(bomReports)); } catch {}
    }, 600);
    return () => window.clearTimeout(timer);
  }, [bomReports]);

  const applyPersistedWorkflow = (
    saved: PersistedWorkflowDraft,
    restoreNavigation = true
  ) => {
    if (restoreNavigation) {
      setView(saved.view || "workflow");
      setStep(Math.min(4, Math.max(1, Number(saved.step || 1))));
    }

    const restoredBatchItems = saved.batchItems || [];
    const restoredDrawingFiles = (saved.files?.length
      ? saved.files
      : restoredBatchItems.map((item) => item.file).filter(Boolean)) as File[];
    const restoredActiveWorkspace = restoredBatchItems.find((item) => item.id === saved.activeBatchId) || restoredBatchItems[0];
    const restoredPrimaryFile = saved.file || restoredActiveWorkspace?.file || restoredDrawingFiles[0] || null;

    setFile(restoredPrimaryFile);
    setFiles(restoredDrawingFiles.length ? restoredDrawingFiles : (restoredPrimaryFile ? [restoredPrimaryFile] : []));
    setBatchItems(restoredBatchItems);
    batchItemsRef.current = restoredBatchItems;
    setBatchFailures(saved.batchFailures || []);
    setActiveBatchId(saved.activeBatchId || "");
    setQuoteMode(saved.quoteMode || "merge");
    setAnalysis(saved.analysis || null);
    setDrawing(saved.drawing || null);
    setRows(saved.rows || []);
    setSummary(saved.summary || emptySummary);
    setFinalPriceOverride(saved.finalPriceOverride ?? null);
    setCommercialAmountOverrides(
      saved.commercialAmountOverrides || {
        material_wastage: null,
        overhead: null,
        markup: null
      }
    );
    setCustomer(saved.customer || "Sample Customer");
    setModelFile(saved.modelFile || null);

    const restoredSources =
      saved.sourceFiles?.length
        ? saved.sourceFiles
        : [
            ...restoredDrawingFiles,
            ...(restoredPrimaryFile && !restoredDrawingFiles.some((item) => fileKey(item) === fileKey(restoredPrimaryFile)) ? [restoredPrimaryFile] : []),
            ...(saved.modelFile ? [saved.modelFile] : [])
          ];

    setSourceFiles(restoredSources);
    setActiveSourceKey(
      saved.activeSourceKey
      || (restoredSources[0] ? fileKey(restoredSources[0]) : "")
    );

    setWorkspaceDatasetId(saved.datasetId || createWorkspaceDatasetId());
    setWorkspaceDatasetName(saved.datasetName || "Quotation Dataset");

    if (saved.dfmReports?.length) {
      setDfmReports(saved.dfmReports);
      setSelectedDfmId(saved.selectedDfmId || saved.dfmReports.at(-1)?.id || "");
    }
    if (saved.bomReports?.length) {
      setBomReports(saved.bomReports);
      setSelectedBomId(saved.selectedBomId || saved.bomReports.at(-1)?.id || "");
    }
  };

  // Restore the exact quotation workflow position and edited data after refresh/reopen.
  useEffect(() => {
    let cancelled = false;

    void loadWorkflowDraft()
      .then(async (saved) => saved || await loadLatestWorkspaceDataset())
      .then((saved) => {
        if (cancelled || !saved) return;

        applyPersistedWorkflow(saved, true);

        if (saved.drawing || saved.analysis || saved.files?.length) {
          setMsg(
            `Workspace dataset restored at Step ${saved.step || 1}. Last auto-save: ${
              saved.savedAt ? new Date(saved.savedAt).toLocaleString() : "saved"
            }.`
          );
        }
      })
      .catch(() => {
        // IndexedDB can be blocked by browser privacy settings; app still works normally.
      })
      .finally(() => {
        if (!cancelled) setDraftHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-save the complete in-progress workflow, including the uploaded File objects.
  useEffect(() => {
    if (!draftHydrated || busy) return;

    const timer = window.setTimeout(() => {
      const activeBatch = batchItemsRef.current.length
        ? batchItemsRef.current.map((item) =>
            item.id === activeBatchId && analysis && drawing
              ? {
                  ...item,
                  file: file || item.file,
                  analysis,
                  drawing,
                  rows,
                  summary
                }
              : item
          )
        : batchItems;

      const snapshot: PersistedWorkflowDraft = {
        view,
        step,
        file,
        files,
        batchItems: activeBatch,
        activeBatchId,
        quoteMode,
        analysis,
        drawing,
        rows,
        summary,
        finalPriceOverride,
        commercialAmountOverrides,
        customer,
        modelFile,
        sourceFiles,
        activeSourceKey,
        datasetId: workspaceDatasetId,
        datasetName: workspaceDatasetName,
        batchFailures,
        dfmReports,
        bomReports,
        selectedDfmId,
        selectedBomId,
        savedAt: new Date().toISOString()
      };

      void Promise.all([
        saveWorkflowDraft(snapshot),
        saveWorkspaceDataset(snapshot)
      ])
        .then(() => {
          saveWorkspaceToDatabase(snapshot);
          void refreshWorkspaceDatasets();
        })
        .catch(() => {
          // Non-blocking auto-save. The current workflow remains usable.
        });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [
    draftHydrated,
    view,
    step,
    file,
    files,
    batchItems,
    activeBatchId,
    quoteMode,
    analysis,
    drawing,
    rows,
    summary,
    finalPriceOverride,
    commercialAmountOverrides,
    customer,
    modelFile,
    sourceFiles,
    activeSourceKey,
    workspaceDatasetId,
    workspaceDatasetName,
    batchFailures,
    dfmReports,
    bomReports,
    selectedDfmId,
    selectedBomId,
    busy,
    refreshWorkspaceDatasets
  ]);

  // Browser Back follows normal in-app history without trapping the user.
  useEffect(() => {
    if (!draftHydrated || historyReadyRef.current) return;

    history.replaceState(
      { dfabApp: true, view, step, datasetId: workspaceDatasetId },
      "",
      window.location.href
    );
    historyReadyRef.current = true;
  }, [draftHydrated]);

  useEffect(() => {
    if (!draftHydrated || !historyReadyRef.current) return;

    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      return;
    }

    history.pushState(
      { dfabApp: true, view, step, datasetId: workspaceDatasetId },
      "",
      window.location.href
    );
  }, [draftHydrated, view, step, workspaceDatasetId]);

  useEffect(() => {
    if (!draftHydrated) return;

    const onPopState = (event: PopStateEvent) => {
      const state = event.state as {
        dfabApp?: boolean;
        view?: View;
        step?: number;
        datasetId?: string;
      } | null;

      if (!state?.dfabApp) return;

      restoringHistoryRef.current = true;
      const targetView = state.view || "dashboard";
      const targetStep = Math.min(4, Math.max(1, Number(state.step || 1)));

      if (targetView === "workflow" && state.datasetId) {
        void loadWorkspaceDataset(state.datasetId)
          .then((saved) => {
            if (saved) applyPersistedWorkflow(saved, false);
          })
          .finally(() => {
            setView(targetView);
            setStep(targetStep);
          });
      } else {
        setView(targetView);
        setStep(targetStep);
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [draftHydrated]);

  useEffect(() => {
    if (!file) {
      setFileUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const resetOngoingQuotationState = (
    message = "Upload a drawing to begin."
  ) => {
    setView("workflow");
    setStep(1);
    setFile(null);
    setFiles([]);
    setBatchItems([]);
    batchItemsRef.current = [];
    setBatchFailures([]);
    setActiveBatchId("");
    setQuoteMode("merge");
    setAnalyzeProgress("");
    setTrainingPromptItems([]);
    setTrainingBusy(false);
    setModelFile(null);
    setSourceFiles([]);
    setActiveSourceKey("");
    setUploadedFileStatus({});
    setShowDfmHistory(false);
    setShowBomHistory(false);
    setAnalysis(null);
    setDrawing(null);
    setRows([]);
    setSummary(emptySummary);
    setFinalPriceOverride(null);
    setCommercialAmountOverrides({
      material_wastage: null,
      overhead: null,
      markup: null
    });
    setWorkspaceDatasetId(createWorkspaceDatasetId());
    setWorkspaceDatasetName("Untitled Quotation Dataset");
    setRevisionComparison(null);
    setMsg(message);
  };

  const deleteOngoingQuotation = async (
    message = "Process ended. Upload a file to start a new quotation."
  ) => {
    const oldDatasetId = workspaceDatasetId;

    // Stop any in-flight DFM/BOM request from writing old results back after
    // this quotation is ended. Requests cannot be physically cancelled here,
    // so stale callbacks are ignored using this lifecycle generation.
    artifactLifecycleRef.current += 1;

    const activeHashes = new Set<string>();
    for (const item of batchItemsRef.current) {
      const hash = item.analysis?.file_hash;
      if (hash) activeHashes.add(hash);
    }
    if (analysis?.file_hash) activeHashes.add(analysis.file_hash);

    // Capture hashes embedded in the currently persisted artifacts too. This
    // covers resumed/partially restored sessions where batchItems may be empty.
    if (selectedDfm?.file_hash) activeHashes.add(selectedDfm.file_hash);
    if (selectedBom?.file_hash) activeHashes.add(selectedBom.file_hash);

    // Clear visible quotation state immediately; storage/server cleanup can run
    // after the UI has returned to a clean upload screen.
    resetOngoingQuotationState(message);

    setSelectedDfmId("");
    setSelectedBomId("");
    setDfmJobs({});
    setBomJobs({});

    // Delete only the engineering artifacts that belong to this ended process.
    // Rate Master, completed quotation history and unrelated DFM/BOM history are
    // intentionally preserved. Persist the filtered lists immediately as well
    // so a refresh cannot resurrect the ended process artifacts.
    setDfmReports((current) => {
      const next = activeHashes.size
        ? current.filter((item) => !activeHashes.has(item.file_hash))
        : current;
      try { localStorage.setItem(DFM_HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setBomReports((current) => {
      const next = activeHashes.size
        ? current.filter((item) => !activeHashes.has(item.file_hash))
        : current;
      try { localStorage.setItem(BOM_HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });

    void Promise.allSettled([
      clearWorkflowDraft(),
      deleteWorkspaceDataset(oldDatasetId),
      api.deleteWorkspaceSession(oldDatasetId)
    ]).finally(() => {
      void refreshWorkspaceDatasets();
    });
  };

  const newQuote = () => {
    // Only one ongoing quotation is allowed.
    // Starting New Quotation automatically deletes the previous ongoing process.
    void deleteOngoingQuotation("New quotation ready. Upload a file to begin.");
  };

  const resumeWorkingQuotation = async () => {
    const hasCurrentWork = Boolean(
      analysis
      || drawing
      || file
      || files.length
      || sourceFiles.length
      || batchItemsRef.current.length
    );

    if (hasCurrentWork) {
      setView("workflow");
      setStep(Math.min(4, Math.max(1, Number(step || 1))));
      setMsg("Ongoing quotation opened.");
      return;
    }

    try {
      const hasSavedWork = (saved: PersistedWorkflowDraft | null) => Boolean(
        saved && (
          saved.analysis
          || saved.drawing
          || saved.file
          || saved.files?.length
          || saved.sourceFiles?.length
          || saved.batchItems?.length
        )
      );

      // Prefer the active draft, but recover the latest valid workspace dataset
      // when that draft is stale/empty. This keeps the Ongoing button tied to
      // real unfinished drawings instead of opening an empty workflow.
      let saved = await loadWorkflowDraft();
      if (!hasSavedWork(saved)) saved = await loadLatestWorkspaceDataset();

      if (hasSavedWork(saved) && saved) {
        applyPersistedWorkflow(saved, false);
        setView("workflow");
        setStep(Math.min(4, Math.max(1, Number(saved.step || 1))));
        setMsg(`Ongoing quotation opened with ${Math.max(saved.batchItems?.length || 0, saved.files?.length || 0, saved.file ? 1 : 0)} drawing${Math.max(saved.batchItems?.length || 0, saved.files?.length || 0, saved.file ? 1 : 0) === 1 ? "" : "s"}.`);
        return;
      }
    } catch {
      // If browser storage is unavailable, remain on the current app state.
    }

    setView("workflow");
    setStep(1);
    setMsg("No ongoing quotation. Upload a file to begin.");
  };

  const removeUploadedSource = (selected: File) => {
    const removedKey = fileKey(selected);
    const currentWorkspaces = snapshotActiveBatch();
    const removedWorkspace = currentWorkspaces.find(
      (item) => fileKey(item.file) === removedKey
    );
    const removedHash = removedWorkspace?.analysis.file_hash || "";

    const remainingSources = allSourceFiles.filter(
      (item) => fileKey(item) !== removedKey
    );
    const remainingDrawings = files.filter(
      (item) => fileKey(item) !== removedKey
    );
    const remainingWorkspaces = currentWorkspaces.filter(
      (item) => fileKey(item.file) !== removedKey
    );

    setSourceFiles(remainingSources);
    setFiles(remainingDrawings);
    replaceBatchItems(remainingWorkspaces);
    setBatchFailures((current) =>
      current.filter((item) => fileKey(item.file) !== removedKey)
    );

    setUploadedFileStatus((current) => {
      const next = { ...current };
      delete next[removedKey];
      return next;
    });

    if (removedHash) {
      setDfmReports((current) =>
        current.filter((item) => item.file_hash !== removedHash)
      );
      setBomReports((current) =>
        current.filter((item) => item.file_hash !== removedHash)
      );
    }

    const remainingModels = remainingSources.filter((item) => isModelSource(item));
    setModelFile(remainingModels.at(-1) || null);

    if (activeSourceKey === removedKey || activeBatchId === removedWorkspace?.id) {
      const nextWorkspace = remainingWorkspaces[0] || null;
      const nextSource = nextWorkspace?.file || remainingSources[0] || null;

      setActiveSourceKey(nextSource ? fileKey(nextSource) : "");

      if (nextWorkspace) {
        setActiveBatchId(nextWorkspace.id);
        setFile(nextWorkspace.file);
        setAnalysis(nextWorkspace.analysis);
        setDrawing(nextWorkspace.drawing);
        setRows(nextWorkspace.rows);
        setSummary(nextWorkspace.summary);
      } else {
        setActiveBatchId("");
        setFile(remainingDrawings[0] || null);
        setAnalysis(null);
        setDrawing(null);
        setRows([]);
        setSummary(emptySummary);
        setStep(1);
      }
    } else if (file && fileKey(file) === removedKey) {
      setFile(remainingDrawings[0] || null);
    }

    if (remainingSources.length === 0) {
      void deleteOngoingQuotation(
        "Quotation ended. Upload a file to start a new quotation."
      );
      return;
    }

    setMsg(`${selected.name} removed from this quotation.`);
  };

  const replaceBatchItems = (items: BatchWorkspace[]) => {
    batchItemsRef.current = items;
    setBatchItems(items);
  };

  const snapshotActiveBatch = () => {
    if (!activeBatchId || !analysis || !drawing) {
      return batchItemsRef.current;
    }

    const next = batchItemsRef.current.map((item) =>
      item.id === activeBatchId
        ? {
            ...item,
            file: file || item.file,
            analysis,
            drawing,
            rows,
            summary
          }
        : item
    );

    replaceBatchItems(next);
    return next;
  };

  const selectBatchDrawing = (id: string) => {
    const current = snapshotActiveBatch();
    const target = current.find((item) => item.id === id);

    if (!target) return;

    setActiveBatchId(target.id);
    setActiveSourceKey(fileKey(target.file));
    setFile(target.file);
    setAnalysis(target.analysis);
    setDrawing(target.drawing);
    setRows(target.rows);
    setSummary(target.summary);
    setFinalPriceOverride(null);
    setRevisionComparison(null);
    setMsg(`Showing drawing ${target.drawing.drawing_no || target.file.name}.`);
  };

  const currentBatchPayload = (): BatchQuoteItem[] => {
    const source = batchItemsRef.current.length
      ? batchItemsRef.current
      : batchItems;

    if (source.length > 0) {
      return source.map((item) => {
        const active =
          item.id === activeBatchId &&
          analysis &&
          drawing
            ? {
                ...item,
                file: file || item.file,
                analysis,
                drawing,
                rows,
                summary
              }
            : item;

        return {
          drawing: active.drawing,
          rows: active.rows,
          summary: active.summary
        };
      });
    }

    if (drawing) {
      return [{ drawing, rows, summary }];
    }

    return [];
  };

  const fileKey = (value: File) =>
    `${value.name}::${value.size}::${value.lastModified}`;

  const wait = (milliseconds: number) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  const acceptParallelArtifacts = (workspace: BatchWorkspace) => {
    const key = workspace.analysis.file_hash || workspace.id;
    const lifecycle = artifactLifecycleRef.current;
    const embeddedDfm = workspace.analysis.dfm;
    const embeddedBom = workspace.analysis.bom;

    if (embeddedDfm) {
      setDfmReports((current) => [
        ...current.filter((item) => item.file_hash !== embeddedDfm.file_hash),
        embeddedDfm
      ]);
      setSelectedDfmId(embeddedDfm.id);
      setDfmJobs((current) => ({
        ...current,
        [key]:
          embeddedDfm.status === "ATTENTION"
            ? "attention"
            : embeddedDfm.status === "REVIEW"
              ? "review"
              : "ready"
      }));
    } else {
      setDfmJobs((current) => ({ ...current, [key]: "processing" }));
      void api.generateDfm({
        fileHash: workspace.analysis.file_hash,
        filename: workspace.file.name,
        drawing: workspace.drawing,
        rows: workspace.rows,
        aiRaw: workspace.analysis.ai_raw || {}
      }).then((report) => {
        if (artifactLifecycleRef.current !== lifecycle) return;
        setDfmReports((current) => [
          ...current.filter((item) => item.file_hash !== report.file_hash),
          report
        ]);
        setSelectedDfmId(report.id);
        setDfmJobs((current) => ({ ...current, [key]: "ready" }));
      }).catch(() => {
        if (artifactLifecycleRef.current !== lifecycle) return;
        setDfmJobs((current) => ({ ...current, [key]: "failed" }));
      });
    }

    if (embeddedBom) {
      setBomReports((current) => [
        ...current.filter((item) => item.file_hash !== embeddedBom.file_hash),
        embeddedBom
      ]);
      setSelectedBomId(embeddedBom.id);
      setBomJobs((current) => ({ ...current, [key]: "ready" }));
    } else {
      setBomJobs((current) => ({ ...current, [key]: "processing" }));
      void api.generateBom({
        fileHash: workspace.analysis.file_hash,
        filename: workspace.file.name,
        drawing: workspace.drawing,
        rows: workspace.rows,
        aiRaw: workspace.analysis.ai_raw || {}
      }).then((report) => {
        if (artifactLifecycleRef.current !== lifecycle) return;
        setBomReports((current) => [
          ...current.filter((item) => item.file_hash !== report.file_hash),
          report
        ]);
        setSelectedBomId(report.id);
        setBomJobs((current) => ({ ...current, [key]: "ready" }));
      }).catch(() => {
        if (artifactLifecycleRef.current !== lifecycle) return;
        setBomJobs((current) => ({ ...current, [key]: "failed" }));
      });
    }
  };


  const analyzeOneWithRetry = async (
    selected: File,
    originalIndex: number,
    total: number
  ): Promise<BatchWorkspace> => {
    let lastError = "Analyze failed";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      setAnalyzeProgress("Analyzing");
      setMsg("Analyzing…");

      try {
        const analyzedResult = isModelSource(selected)
          ? await api.analyzeCad(await inspectCadFile(selected))
          : await api.analyzeDrawing(selected, false);
        const result = enrichPartSummary(analyzedResult);

        const itemSummary =
          result.summary || await api.calculateQuote(result.rows);

        const workspace: BatchWorkspace = {
          id: `${result.file_hash}-${originalIndex}`,
          file: selected,
          analysis: result,
          drawing: result.drawing,
          rows: result.rows,
          summary: itemSummary
        };

        acceptParallelArtifacts(workspace);
        return workspace;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : "Analyze failed";

        const upper = lastError.toUpperCase();
        const rateLimited =
          upper.includes("429")
          || upper.includes("RESOURCE_EXHAUSTED")
          || upper.includes("RATE LIMIT");

        const retryableServiceError =
          upper.includes("503")
          || upper.includes("UNAVAILABLE")
          || upper.includes("TIMEOUT")
          || upper.includes("DEADLINE_EXCEEDED");

        if (rateLimited || !retryableServiceError) {
          break;
        }

        if (attempt < 2) {
          await wait(600);
        }
      }
    }

    try {
      const fallbackRaw = await api.analyzeFallback(
        selected,
        lastError || "Automatic extraction did not complete."
      );
      const fallback = enrichPartSummary(fallbackRaw);

      const fallbackSummary =
        fallback.summary || await api.calculateQuote(fallback.rows);

      const fallbackWorkspace: BatchWorkspace = {
        id: fileKey(selected),
        file: selected,
        analysis: fallback,
        drawing: fallback.drawing,
        rows: fallback.rows,
        summary: fallbackSummary
      };

      acceptParallelArtifacts(fallbackWorkspace);
      return fallbackWorkspace;
    } catch {
      throw new Error(lastError);
    }
  };

  const sortBatchBySelectedFiles = (items: BatchWorkspace[]) => {
    const order = new Map(
      allSourceFiles.map((selected, index) => [fileKey(selected), index])
    );

    return [...items].sort(
      (a, b) =>
        (order.get(fileKey(a.file)) ?? 9999) -
        (order.get(fileKey(b.file)) ?? 9999)
    );
  };

  const retryFailedDrawings = async () => {
    if (!batchFailures.length || busy) return;

    setBusy(true);

    const recovered: BatchWorkspace[] = [];
    const stillFailed: BatchFailure[] = [];

    try {
      for (const failure of batchFailures) {
        const originalIndex = Math.max(
          0,
          allSourceFiles.findIndex(
            (selected) => fileKey(selected) === fileKey(failure.file)
          )
        );

        try {
          recovered.push(
            await analyzeOneWithRetry(
              failure.file,
              originalIndex,
              allSourceFiles.length || batchItems.length + batchFailures.length
            )
          );
        } catch (error) {
          stillFailed.push({
            file: failure.file,
            error:
              error instanceof Error
                ? error.message
                : "Analyze failed"
          });
        }
      }

      if (recovered.length) {
        const existingKeys = new Set(
          recovered.map((item) => fileKey(item.file))
        );

        const merged = sortBatchBySelectedFiles([
          ...batchItemsRef.current.filter(
            (item) => !existingKeys.has(fileKey(item.file))
          ),
          ...recovered
        ]);

        replaceBatchItems(merged);

        if (!activeBatchId && merged.length) {
          const first = merged[0];
          setActiveBatchId(first.id);
          setActiveSourceKey(fileKey(first.file));
          setFile(first.file);
          setAnalysis(first.analysis);
          setDrawing(first.drawing);
          setRows(first.rows);
          setSummary(first.summary);
        }
      }

      setBatchFailures(stillFailed);

      const analyzedCount =
        batchItemsRef.current.length +
        recovered.length;

      if (!stillFailed.length) {
        setMsg(
          `All ${allSourceFiles.length || analyzedCount} source files analyzed successfully.`
        );
      } else {
        setMsg(
          `${analyzedCount} of ${allSourceFiles.length || analyzedCount + stillFailed.length} source files analyzed. ${stillFailed.length} still need retry.`
        );
      }
    } finally {
      setAnalyzeProgress("");
      setBusy(false);
    }
  };

  const openMaterialCalculator = (requestedRow?: CostRow) => {
    const materialRow = requestedRow || rows.find((row) => String(row.category || "").toUpperCase() === "MATERIAL");
    const geometry = analysis?.ai_raw?.cad_geometry?.dimensions_mm || {};
    const x = Number(geometry.x || 0);
    const y = Number(geometry.y || 0);
    const z = Number(geometry.z || 0);
    const shape = inferMaterialShape(analysis?.ai_raw);
    const ai = analysis?.ai_raw;
    const thicknessPrediction = predictedThickness(ai, drawing!);
    const weightPrediction = predictedPartWeight(ai, drawing!);
    const dimensions = ((ai?.dimensions || []) as Record<string, unknown>[]).map((row) => ({
      label: String(row.label || row.type || "").toLowerCase(),
      value: normalizedDimensionMm(row)
    })).filter((row) => Number.isFinite(row.value) && row.value > 0);
    const dimensionByLabel = (keys: string[]) => dimensions.find((row) => keys.some((key) => row.label.includes(key)))?.value || 0;
    const overallValues = dimensions.map((row) => row.value).sort((a, b) => b - a);
    const envelope = ai ? parsedEngineeringEnvelopeMm(ai) : null;
    const inferredLength = dimensionByLabel(["length", "overall length", "oal"]) || x || envelope?.widthMm || overallValues[0] || 0;
    const inferredWidth = dimensionByLabel(["width", "breadth", "overall width"]) || y || envelope?.heightMm || overallValues[1] || 0;
    const inferredHeight = dimensionByLabel(["height", "overall height"]) || z || overallValues[2] || 0;
    const inferredDiameter = dimensionByLabel(["diameter", "dia", "od", "ø"]) || y || inferredWidth || 0;
    const inferredOd = dimensionByLabel(["outer diameter", "outside dia", "od"]) || inferredDiameter;
    const hasDrawingWeight = String((ai as (AIExtraction & { weight_source?: string }) | undefined)?.weight_source || "") === "drawing_stated"
      && Number((ai as (AIExtraction & { drawing_stated_weight_kg?: number }) | undefined)?.drawing_stated_weight_kg || 0) > 0;
    const predictedThicknessMm = Number(thicknessPrediction?.value || (hasDrawingWeight ? 0 : DEFAULT_FALLBACK_THICKNESS_MM));
    const inferredIdRaw = dimensionByLabel(["inner diameter", "inside dia", "id"]);
    const inferredId = inferredIdRaw > 0
      ? inferredIdRaw
      : (inferredOd > predictedThicknessMm * 2 ? inferredOd - predictedThicknessMm * 2 : 0);
    const materialName = materialRow?.item || drawing?.material || "";
    const savedRate = materialRow?.rate > 0
      ? Number(materialRow.rate)
      : Number(rates.find((rate) =>
          rate.active
          && rate.category === "MATERIAL"
          && rateChoiceLabel(rate) === materialName
        )?.price || 0);

    setMaterialCalculator({
      ...EMPTY_MATERIAL_CALCULATOR,
      rowId: materialRow?.id || "",
      shape,
      lengthMm: inferredLength,
      widthMm: inferredWidth,
      heightMm: inferredHeight,
      thicknessMm: predictedThicknessMm,
      diameterMm: inferredDiameter,
      outerDiameterMm: inferredOd,
      innerDiameterMm: inferredId,
      wallThicknessMm: predictedThicknessMm,
      legAMm: inferredWidth,
      legBMm: inferredHeight,
      quantity: Math.max(1, Number(ai?.product_quantity || drawing?.quantity || 1)),
      densityKgM3: inferMaterialDensity(drawing?.material || materialName) || 7850,
      pricePerKg: savedRate,
      predictedBaseWeightKg: Number(weightPrediction?.baseWeightKg || 0),
      allowanceKg: 1,
      predictedTotalWeightKg: Number(weightPrediction?.totalWeightKg || 0),
      predictionBasis: String(weightPrediction?.basis || thicknessPrediction?.basis || "")
    });
    setMaterialCalculatorMissing([]);
    setShowMaterialCalculator(true);
  };

  const applyMaterialCalculator = async () => {
    const missing = materialCalculatorErrors(materialCalculator);
    if (missing.length) {
      setMaterialCalculatorMissing(missing);
      setMsg(`Material calculation needs: ${missing.join(", ")}.`);
      return;
    }

    const volumeMm3 = materialVolumeMm3(materialCalculator);
    const unitWeightKg = volumeMm3 * materialCalculator.densityKgM3 / 1_000_000_000;
    const geometricTotalWeightKg = unitWeightKg * materialCalculator.quantity;
    const predictedBaseWeightKg = materialCalculator.predictedBaseWeightKg > 0
      ? materialCalculator.predictedBaseWeightKg
      : (materialCalculator.predictedTotalWeightKg > 0 ? Math.max(0, materialCalculator.predictedTotalWeightKg - 1) : 0);
    const totalWeightKg = predictedBaseWeightKg > 0
      ? predictedBaseWeightKg + Math.max(0, materialCalculator.allowanceKg)
      : (geometricTotalWeightKg > 0 ? geometricTotalWeightKg + Math.max(0, materialCalculator.allowanceKg) : 0);

    if (!(totalWeightKg > 0)) {
      setMaterialCalculatorMissing(["Valid product dimensions"]);
      setMsg("Material calculation could not produce a valid weight. Check the dimensions.");
      return;
    }

    const shapeLabel: Record<MaterialShape, string> = {
      plate: "Plate / Block",
      round_bar: "Round Bar",
      pipe: "Pipe / Tube",
      rect_tube: "Rectangular Tube",
      angle: "Angle"
    };

    const allowanceText = `${Math.max(0, materialCalculator.allowanceKg).toFixed(3)} kg allowance`;
    const basis = predictedBaseWeightKg > 0
      ? `Auto drawing prediction · ${predictedBaseWeightKg.toFixed(3)} kg + ${allowanceText}`
      : `${materialCalculator.quantity} × ${shapeLabel[materialCalculator.shape]} · ${unitWeightKg.toFixed(3)} kg/pc + ${allowanceText}`;
    const existing = rows.find((row) => row.id === materialCalculator.rowId);
    const nextMaterialRow: CostRow = {
      ...(existing || {
        id: `material-calculator-${Date.now()}`,
        category: "MATERIAL",
        item: drawing?.material || "Material",
        drawingQty: "",
        costingQty: 0,
        unit: "kg",
        rate: 0,
        cost: 0,
        confidence: "Exact",
        rateId: null,
        rateSource: "Material Calculator",
        criticalScore: 100
      }),
      category: "MATERIAL",
      drawingQty: basis,
      costingQty: Number(totalWeightKg.toFixed(4)),
      unit: "kg",
      rate: Number(materialCalculator.pricePerKg),
      cost: Number(totalWeightKg.toFixed(4)) * Number(materialCalculator.pricePerKg),
      confidence: "Exact",
      rateSource: materialCalculator.pricePerKg > 0 ? "Material Calculator · Auto/confirmed Rate" : "Material Calculator",
      criticalScore: Math.max(70, Number(existing?.criticalScore || 100))
    };

    let appliedMaterialRow = nextMaterialRow;

    // A quotation-entered material ₹/kg rate is also a reusable Rate Master value.
    // Reuse the existing sync endpoint so material family + grade/spec stay consistent
    // with manual cost-sheet edits and do not require a second admin entry.
    if (Number(materialCalculator.pricePerKg || 0) > 0) {
      try {
        const synced = await api.syncCostRowRate(
          nextMaterialRow,
          analysis?.ai_raw?.material
        );
        appliedMaterialRow = synced.row;
        setRates((current) => {
          const index = current.findIndex((rate) => rate.id === synced.rate.id);
          if (index < 0) return [...current, synced.rate];
          const next = [...current];
          next[index] = synced.rate;
          return next;
        });
      } catch (error) {
        // Keep quotation costing usable even if persistence temporarily fails.
        console.warn("Material Rate Master auto-sync failed", error);
      }
    }

    const nextRows = existing
      ? rows.map((row) => row.id === existing.id ? appliedMaterialRow : row)
      : [appliedMaterialRow, ...rows];

    await recalc(nextRows);
    setShowMaterialCalculator(false);
    setMaterialCalculatorMissing([]);
    setMsg(`Material calculated: ${totalWeightKg.toFixed(3)} kg × ${money(materialCalculator.pricePerKg)}/kg = ${money(totalWeightKg * materialCalculator.pricePerKg)}. Rate Master synced automatically.`);
  };

  const goWorkflowStep = (targetStep: number) => {
    if (targetStep === 4 && batchFailures.length > 0) {
      setMsg(
        `${batchFailures.length} drawing(s) still failed analysis. Retry them before preparing quotation.`
      );
      return;
    }

    if (targetStep === 4) {
      const materialRows = rows.filter((row) => String(row.category || "").toUpperCase() === "MATERIAL");
      const incompleteMaterial = materialRows.find((row) =>
        Number(row.costingQty || 0) <= 0
        || Number(row.rate || 0) <= 0
        || !String(row.unit || "").trim()
      );

      if (!materialRows.length || incompleteMaterial) {
        setMsg("Complete material size, quantity, calculated kg and price before preparing the quotation.");
        openMaterialCalculator(incompleteMaterial);
        return;
      }
    }

    if (targetStep === 1 || drawing) {
      setStep(targetStep);
    }
  };

  const recalc = useCallback(async (
    nextRows: CostRow[],
    overrides?: {
      material_wastage_override?: number | null;
      overhead_override?: number | null;
      markup_override?: number | null;
      selling_price_override?: number | null;
    }
  ) => {
    const updated = nextRows.map((row) => ({
      ...row,
      cost: (+row.costingQty || 0) * (+row.rate || 0)
    }));
    setRows(updated);

    const commercialValues = overrides || {
      material_wastage_override: commercialAmountOverrides.material_wastage,
      overhead_override: commercialAmountOverrides.overhead,
      markup_override: commercialAmountOverrides.markup,
      selling_price_override: finalPriceOverride
    };

    try {
      setSummary(
        await api.calculateQuote(updated, commercialValues)
      );
    } catch {
      setMsg("Could not recalculate. Check backend connection.");
    }
  }, [
    commercialAmountOverrides.material_wastage,
    commercialAmountOverrides.overhead,
    commercialAmountOverrides.markup,
    finalPriceOverride
  ]);

  const updateCommercial = async (
    field: "material_wastage" | "overhead" | "markup" | "selling_price",
    rawValue: string
  ) => {
    const parsed = rawValue.trim() === ""
      ? null
      : Math.max(0, Number(rawValue) || 0);

    if (field === "selling_price") {
      setFinalPriceOverride(parsed);

      await recalc(rows, {
        material_wastage_override: commercialAmountOverrides.material_wastage,
        overhead_override: commercialAmountOverrides.overhead,
        markup_override: commercialAmountOverrides.markup,
        selling_price_override: parsed
      });
      return;
    }

    // Editing any commercial amount releases the final-price override so the
    // final selling price follows the new amount.
    setFinalPriceOverride(null);

    const nextOverrides: CommercialAmountOverrides = {
      ...commercialAmountOverrides,
      [field]: parsed
    };

    setCommercialAmountOverrides(nextOverrides);

    await recalc(rows, {
      material_wastage_override: nextOverrides.material_wastage,
      overhead_override: nextOverrides.overhead,
      markup_override: nextOverrides.markup,
      selling_price_override: null
    });
  };


  const saveAppSettings = async () => {
    if (!settings) return;

    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);

      if (rows.length) {
        setSummary(
          await api.calculateQuote(rows, {
            material_wastage_override: commercialAmountOverrides.material_wastage,
            overhead_override: commercialAmountOverrides.overhead,
            markup_override: commercialAmountOverrides.markup,
            selling_price_override: finalPriceOverride
          })
        );
      }

      setMsg("Settings saved and applied to the current costing sheet.");
      void refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Settings save failed.");
    }
  };

  const analyze = async () => {
    const selectedFiles = allSourceFiles;

    if (!selectedFiles.length) return;

    setAnalysis(null);
    setDrawing(null);
    setRows([]);
    setSummary(emptySummary);
    setFinalPriceOverride(null);
    setCommercialAmountOverrides({
      material_wastage: null,
      overhead: null,
      markup: null
    });
    setBatchItems([]);
    batchItemsRef.current = [];
    setBatchFailures([]);
    setActiveBatchId("");
    setBusy(true);

    const completed: BatchWorkspace[] = [];
    const failed: BatchFailure[] = [];

    try {
      let nextIndex = 0;

      const worker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;

          if (index >= selectedFiles.length) {
            return;
          }

          const selected = selectedFiles[index];

          try {
            completed.push(
              await analyzeOneWithRetry(
                selected,
                index,
                selectedFiles.length
              )
            );
          } catch (error) {
            failed.push({
              file: selected,
              error:
                error instanceof Error
                  ? error.message
                  : "Analyze failed"
            });
          }
        }
      };

      const workerCount = Math.min(
        BATCH_ANALYZE_CONCURRENCY,
        selectedFiles.length
      );

      await Promise.all(
        Array.from(
          { length: workerCount },
          () => worker()
        )
      );

      const ordered = sortBatchBySelectedFiles(completed);
      replaceBatchItems(ordered);
      setBatchFailures(failed);

      if (!ordered.length) {
        setMsg(
          failed.length
            ? `0 of ${selectedFiles.length} source files analyzed. Use Retry Failed.`
            : "No source files were analyzed."
        );
        return;
      }

      const first = ordered[0];

      setActiveBatchId(first.id);
      setActiveSourceKey(fileKey(first.file));
      setFile(first.file);
      setAnalysis(first.analysis);
      setDrawing(first.drawing);
      setRows(first.rows);
      setSummary(first.summary);
      setQuoteMode(
        selectedFiles.length > 1
          ? "merge"
          : "separate"
      );
      setStep(2);

      if (!failed.length) {
        setMsg(
          selectedFiles.length === 1
            ? "1 source file analyzed."
            : `All ${selectedFiles.length} source files analyzed independently. Select any source to review its own details.`
        );
      } else {
        setMsg(
          `${ordered.length} of ${selectedFiles.length} source files analyzed. ${failed.length} failed after 2 attempts — use Retry Failed.`
        );
      }

      void refresh();
    } finally {
      setAnalyzeProgress("");
      setBusy(false);
    }
  };

  const refreshPremiumEstimate = useCallback(async (targetDrawing = drawing, targetRows = rows, targetAnalysis = analysis) => {
    if (!targetDrawing || !targetAnalysis) return;
    setPremiumBusy(true);
    try {
      const result = await api.getPremiumEstimate({
        drawing: targetDrawing,
        rows: targetRows,
        ai_raw: (targetAnalysis.ai_raw || {}) as Record<string, unknown>
      });
      setPremiumEstimate(result);
    } catch (error) {
      console.warn("Premium estimate unavailable", error);
    } finally {
      setPremiumBusy(false);
    }
  }, [analysis, drawing, rows]);

  const applyPremiumProcessCosting = useCallback(async () => {
    if (!premiumEstimate || !drawing) return;
    const existingNames = new Set(rows.map((row) => `${row.category}:${row.item}`.toLowerCase()));
    const suggested: CostRow[] = premiumEstimate.process_route
      .filter((item) => !existingNames.has(`process:${item.process}`.toLowerCase()))
      .map((item, index) => {
        const totalHours = Math.max(0, item.setup_hours + item.run_hours_per_piece * Math.max(1, drawing.quantity || 1));
        const rate = Math.max(0, item.machine_rate + item.labour_rate);
        return {
          id: `PREMIUM-PROC-${Date.now()}-${index}`,
          category: "PROCESS",
          item: item.process,
          drawingQty: `${item.setup_hours.toFixed(2)} h setup + ${item.run_hours_per_piece.toFixed(2)} h/pc × ${Math.max(1, drawing.quantity || 1)}`,
          costingQty: Number(totalHours.toFixed(4)),
          unit: "hr",
          rate,
          cost: Number((totalHours * rate).toFixed(2)),
          confidence: item.confidence >= 85 ? "Exact" : "Estimated",
          rateId: null,
          rateSource: item.rate_source || "Premium Estimator",
          criticalScore: item.confidence >= 85 ? 35 : 60
        };
      });
    if (!suggested.length) {
      setMsg("Premium process costing is already present in the cost sheet.");
      return;
    }
    const nextRows = [...rows, ...suggested];
    await recalc(nextRows);
    setMsg(`${suggested.length} premium process cost row${suggested.length === 1 ? "" : "s"} applied.`);
  }, [premiumEstimate, drawing, rows, recalc]);

  const recordActualPerformance = useCallback(async () => {
    if (!drawing) return;
    try {
      await api.saveActualCost({
        drawing,
        quoted_cost: summary.manufacturing_cost || summary.direct_cost,
        actual_cost: Math.max(0, actualCostDraft.actualCost),
        quoted_hours: premiumEstimate?.process_route.reduce((sum, item) => sum + item.setup_hours + item.run_hours_per_piece * Math.max(1, drawing.quantity || 1), 0) || 0,
        actual_hours: Math.max(0, actualCostDraft.actualHours),
        notes: actualCostDraft.notes
      });
      setMsg("Actual job performance saved to estimator learning memory.");
      setActualCostDraft({ actualCost: 0, actualHours: 0, notes: "" });
      void refreshPremiumEstimate();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not save actual job performance.");
    }
  }, [drawing, summary, actualCostDraft, premiumEstimate, refreshPremiumEstimate]);

  const askEstimator = useCallback(() => {
    const q = estimatorQuestion.trim().toLowerCase();
    if (!q || !premiumEstimate) return;
    const top = premiumEstimate.cost_drivers[0];
    let answer = `Recommended sell is ${money(premiumEstimate.margin.recommended_sell)} with an estimated ${premiumEstimate.margin.gross_margin_pct.toFixed(1)}% gross margin and ${premiumEstimate.lead_time.working_days} working-day lead time.`;
    if (q.includes("why") || q.includes("cost")) answer = top ? `${top.name} is currently the largest cost driver at ${money(top.amount)}. ${premiumEstimate.savings[0] || "Review process rates and setup/run assumptions before release."}` : answer;
    else if (q.includes("reduce") || q.includes("save")) answer = premiumEstimate.savings.join(" ") || "No obvious deterministic saving is available from the extracted data; review geometry, quantity and supplier rates.";
    else if (q.includes("lead") || q.includes("delivery")) answer = `Normal lead time is ${premiumEstimate.lead_time.working_days} working days; expedite planning is approximately ${premiumEstimate.lead_time.expedite_days} days before capacity confirmation.`;
    else if (q.includes("similar")) answer = premiumEstimate.similar_jobs[0] ? `Closest saved quotation is ${premiumEstimate.similar_jobs[0].drawing_no || premiumEstimate.similar_jobs[0].description} at ${premiumEstimate.similar_jobs[0].score}% similarity and ${money(premiumEstimate.similar_jobs[0].selling_price)} selling price.` : "No sufficiently similar saved quotation was found yet.";
    else if (q.includes("risk") || q.includes("attention")) answer = [...premiumEstimate.attention, ...premiumEstimate.dfm_warnings.map(x => x.message)].slice(0, 4).join(" ") || "No major deterministic attention item is currently detected.";
    setEstimatorAnswer(answer);
  }, [estimatorQuestion, premiumEstimate]);

  const comparePreviousRevision = async () => {
    if (!drawing || !analysis) return;

    try {
      setBusy(true);
      const result = await api.compareCurrentRevision({
        drawing,
        summary,
        rows,
        ai_raw: analysis.ai_raw || {},
        note: "Current comparison"
      });
      setRevisionComparison(result);
      setMsg(result.available
        ? `Compared with revision ${result.baseline_revision || "previous"}.`
        : "No previous revision snapshot found for this drawing.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Revision comparison failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveReview = async () => {
    if (!analysis || !drawing) return;
    snapshotActiveBatch();
    setBusy(true);
    try {
      await Promise.all([
        api.saveReview({
          extraction_id: analysis.extraction_id,
          file_hash: analysis.file_hash,
          drawing,
          rows,
          ai_raw: analysis.ai_raw || {}
        }),
        api.saveRevision({
          drawing,
          summary,
          rows,
          ai_raw: analysis.ai_raw || {},
          note: "Reviewed extraction saved"
        })
      ]);
      setStep(3);
      setMsg("Review saved. Continue with engineering and costing.");
      void refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };


  const onCostCellChanged = async (event: CellValueChangedEvent<CostRow>) => {
    if (!event.data) return;

    const edited = { ...event.data };
    const field = String(event.colDef.field || "");

    if (field === "item") {
      const selectedRate = rates.find(
        (rate) => rate.active && rateChoiceLabel(rate) === edited.item
      );

      if (selectedRate) {
        edited.category = selectedRate.category;
        edited.rateId = selectedRate.id;
        edited.unit = selectedRate.unit;
        edited.rate = Number(selectedRate.price || 0);
        edited.cost = Number(edited.costingQty || 0) * edited.rate;
        edited.rateSource = "Rate Master";
        edited.criticalScore = selectedRate.critical_score;

        await recalc(
          rows.map((row) => row.id === edited.id ? edited : row)
        );
        setMsg(`${rateChoiceLabel(selectedRate)} selected from Rate Master.`);
        return;
      }
    }

    if (field === "category") {
      await recalc(rows.map((row) => row.id === edited.id ? edited : row));
      return;
    }

    const shouldSyncRate = [
      "unit",
      "rate",
      "cost"
    ].includes(field);

    if (shouldSyncRate) {
      edited.rateSource = "Manual Override";
      edited.criticalScore = 100;

      try {
        const synced = await api.syncCostRowRate(
          edited,
          analysis?.ai_raw?.material
        );

        setRates((current) => {
          const index = current.findIndex(
            (rate) => rate.id === synced.rate.id
          );

          if (index < 0) return [...current, synced.rate];

          const next = [...current];
          next[index] = synced.rate;
          return next;
        });

        await recalc(
          rows.map((row) =>
            row.id === synced.row.id ? synced.row : row
          )
        );

        setMsg("Rate Master updated automatically from the cost sheet.");
        return;
      } catch (error) {
        setMsg(
          error instanceof Error
            ? `Cost updated, but Rate Master sync failed: ${error.message}`
            : "Cost updated, but Rate Master sync failed."
        );
      }
    }

    await recalc(
      rows.map((row) => row.id === edited.id ? edited : row)
    );
  };

  const refreshCostRates = async () => {
    setBusy(true);
    try {
      const updated = await api.applySavedRates(rows);
      await recalc(updated);
      setMsg("Latest active rates from Rate Master applied to the cost sheet.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not refresh rates.");
    } finally {
      setBusy(false);
    }
  };

  const addCostRow = () => {
    const row: CostRow = {
      id: `manual-${Date.now()}`,
      category: "PROCESS",
      item: "New Cost Item",
      drawingQty: "",
      costingQty: 1,
      unit: "job",
      rate: 0,
      cost: 0,
      confidence: "Estimated",
      rateId: null,
      rateSource: "Manual Override",
      criticalScore: 100
    };

    void recalc([...rows, row]);
  };

  const removeCostRow = (rowId: string) => {
    void recalc(rows.filter((row) => row.id !== rowId));
  };

  const updateEngineeringData = (next: AIExtraction) => {
    setAnalysis((current) => current ? {
      ...current,
      ai_raw: next,
      engineering_intelligence: next.engineering_intelligence || current.engineering_intelligence
    } : current);

    setDrawing((current) => {
      if (!current) return current;

      const materialParts = [
        next.material?.family,
        next.material?.grade,
        next.material?.specification
      ].map((value) => String(value || "").trim()).filter(Boolean);

      return {
        ...current,
        material: materialParts.join(" ") || current.material,
        thickness_mm: next.thickness_mm == null ? 0 : Number(next.thickness_mm),
        weight_kg: next.weight_kg == null ? 0 : Number(next.weight_kg),
        quantity: Math.max(1, Number(next.product_quantity || current.quantity || 1))
      };
    });
  };

  const columns = useMemo<ColDef<CostRow>[]>(() => [
    {
      headerName: "Status",
      colId: "status",
      width: 96,
      minWidth: 96,
      maxWidth: 105,
      sortable: false,
      resizable: false,
      cellRenderer: (p: { data?: CostRow }) => <StatusDot signal={costRowSignal(p.data)}/>
    },
    {
      field: "category",
      headerName: "Category",
      editable: true,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["MATERIAL", "PROCESS", "LABOUR", "OTHER"] },
      minWidth: 115,
      maxWidth: 145
    },
    {
      field: "item",
      headerName: "Material / Process / Labour",
      editable: true,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: (p: { data?: CostRow }) => {
        const category = String(p.data?.category || "PROCESS").toUpperCase();
        const values = rates
          .filter((rate) => rate.active && rate.category === category)
          .map(rateChoiceLabel);
        const current = String(p.data?.item || "");
        return { values: Array.from(new Set([current, ...values].filter(Boolean))) };
      },
      minWidth: 250,
      flex: 1.7
    },
    {
      field: "drawingQty",
      headerName: "Drawing Qty",
      editable: true,
      minWidth: 125
    },
    {
      field: "costingQty",
      headerName: "Cost Qty",
      editable: true,
      minWidth: 118,
      valueParser: (p) => Number(p.newValue) || 0,
      valueFormatter: (p) => {
        const value = Number(p.value || 0);
        const category = String(p.data?.category || "").toUpperCase();
        const unit = String(p.data?.unit || "");

        if (category === "MATERIAL" && unit.toLowerCase() === "kg") {
          return `${Number(value.toFixed(4))} kg`;
        }

        return String(Number(value.toFixed(4)));
      }
    },
    {
      field: "unit",
      headerName: "Unit",
      editable: true,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: (p: { data?: CostRow }) => {
        const current = String(p.data?.unit || "");
        const values = Array.from(new Set([
          current,
          ...(catalog?.units || []),
          ...rates.map((rate) => rate.unit)
        ].filter(Boolean)));
        return { values };
      },
      minWidth: 80,
      maxWidth: 105
    },
    {
      field: "rate",
      headerName: "Rate",
      editable: true,
      minWidth: 115,
      valueParser: (p) => Number(p.newValue) || 0,
      valueFormatter: (p) =>
        Number(p.value || 0) === 0 && String(p.data?.rateSource || "").startsWith("RATE MISSING")
          ? ""
          : money(Number(p.value || 0))
    },
    {
      field: "rateSource",
      headerName: "Rate Source",
      editable: true,
      minWidth: 145
    },
    {
      field: "cost",
      headerName: "Amount",
      editable: true,
      minWidth: 125,
      valueParser: (p) => Number(p.newValue) || 0,
      valueSetter: (p) => {
        const desired = Number(p.newValue) || 0;
        const qty = Number(p.data.costingQty) || 0;

        p.data.cost = desired;
        p.data.rate = qty > 0 ? desired / qty : desired;
        p.data.rateSource = "Manual Override";
        p.data.criticalScore = 100;
        return true;
      },
      valueFormatter: (p) =>
        Number(p.value || 0) === 0 && String(p.data?.rateSource || "").startsWith("RATE MISSING")
          ? ""
          : money(Number(p.value || 0))
    },
    {
      headerName: "Action",
      colId: "action",
      width: 178,
      minWidth: 178,
      maxWidth: 178,
      sortable: false,
      resizable: false,
      cellRenderer: (p: { data?: CostRow }) => (
        <div className="grid-row-actions">
          {String(p.data?.category || "").toUpperCase() === "MATERIAL" && (
            <button
              type="button"
              className="grid-calc-btn"
              onClick={() => p.data && openMaterialCalculator(p.data)}
            >
              Calculate
            </button>
          )}
          <button
            type="button"
            className="grid-delete-btn"
            onClick={() => p.data && removeCostRow(p.data.id)}
          >
            Remove
          </button>
        </div>
      )
    }
  ], [rows, rates, catalog, drawing, analysis]);

  const saveQuotation = async (status = "Draft") => {
    if (!drawing) return;

    const items = currentBatchPayload();

    if (items.length <= 1) {
      const quote = await api.saveQuote({
        customer,
        drawing,
        rows,
        summary,
        status
      });
      await refresh();
      setMsg(`Quotation ${quote.id} saved as ${status}.`);
      return;
    }

    const result = await api.saveBatchQuote(
      customer,
      quoteMode,
      items,
      status
    );

    await refresh();

    setMsg(
      quoteMode === "merge"
        ? `Merged quotation ${result.id} saved as ${status}.`
        : `${result.count} separate quotations saved as ${status}.`
    );
  };

  const recordDownloadedQuotation = async () => {
    if (!drawing) return;

    const items = currentBatchPayload();

    try {
      if (items.length <= 1) {
        const saved = await api.saveQuote({
          customer,
          drawing,
          rows,
          summary,
          status: "Downloaded"
        });
        setQuotes((current) => [
          ...current.filter((quote) => quote.id !== saved.id),
          saved
        ]);
      } else {
        const saved = await api.saveBatchQuote(
          customer,
          quoteMode,
          items,
          "Downloaded"
        );
        setQuotes((current) => [
          ...current,
          ...saved.records.filter(
            (incoming) => !current.some((quote) => quote.id === incoming.id)
          )
        ]);
      }
    } catch (error) {
      setMsg(
        error instanceof Error
          ? `Quotation downloaded, but history save failed: ${error.message}`
          : "Quotation downloaded, but history save failed."
      );
    }
  };

  const renameSavedQuote = async (quote: QuoteRecord) => {
    const currentName = quote.name || quote.description || quote.id;
    const nextName = window.prompt("Rename quotation", currentName)?.trim();

    if (!nextName || nextName === currentName) return;

    try {
      const updated = await api.renameQuote(quote.id, nextName);
      setQuotes((current) =>
        current.map((item) => item.id === quote.id ? updated : item)
      );
      setMsg(`Quotation renamed to "${nextName}".`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Rename failed.");
    }
  };

  const deleteSavedQuote = async (quote: QuoteRecord) => {
    const label = quote.name || quote.description || quote.id;

    if (!window.confirm(`Delete "${label}" from Quotation History?`)) {
      return;
    }

    try {
      await api.deleteQuote(quote.id);
      setQuotes((current) => current.filter((item) => item.id !== quote.id));
      setMsg(`Quotation ${quote.id} deleted from history.`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  const trainingCandidates = (): BatchWorkspace[] => {
    const current = snapshotActiveBatch();

    if (current.length) {
      return current.filter((item) => item.file && item.analysis && item.drawing);
    }

    if (file && analysis && drawing) {
      return [{
        id: activeBatchId || `${analysis.file_hash}-single`,
        file,
        analysis,
        drawing,
        rows,
        summary
      }];
    }

    return [];
  };

  const generateQuotation = async () => {
    if (!drawing) return;

    const items = currentBatchPayload();

    if (items.length <= 1) {
      await api.exportPdf(
        drawing,
        rows,
        summary,
        customer
      );
    } else {
      await api.exportBatchPdf(
        customer,
        quoteMode,
        items
      );
    }

    // PDF/ZIP download finishes first. Then immediately ask for explicit
    // Training Dataset approval and persist this download in Quotation History.
    setTrainingPromptItems(trainingCandidates());
    void recordDownloadedQuotation();
  };

  const sendCurrentQuotationToTraining = async () => {
    if (!trainingPromptItems.length || trainingBusy) return;

    setTrainingBusy(true);

    try {
      const results = await Promise.allSettled(
        trainingPromptItems.map((item) =>
          api.sendTrainingSample({
            file: item.file,
            extractionId: item.analysis.extraction_id,
            fileHash: item.analysis.file_hash,
            customer,
            drawing: item.drawing,
            rows: item.rows,
            summary: item.summary,
            aiRaw: item.analysis.ai_raw || {}
          })
        )
      );

      const saved = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - saved;

      setTrainingPromptItems([]);
      void refresh();

      setMsg(
        failed
          ? `${saved} drawing(s) sent to Training Dataset; ${failed} failed to save.`
          : `${saved} drawing(s) sent to Training Dataset with original drawing + final reviewed costing.`
      );
    } finally {
      setTrainingBusy(false);
    }
  };

  const openRates = () => {
    setView("rates");
    setRateTab("MATERIAL");
    setRateSearch("");

    // Rate Master should open immediately from cached state. Refresh only its
    // two required resources in parallel instead of waiting for dashboard/history.
    void Promise.allSettled([api.getRates(), api.getRateCatalog()]).then(([rateResult, catalogResult]) => {
      if (rateResult.status === "fulfilled") setRates(rateResult.value);
      if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
    });
  };

  const restoreStarterRates = async () => {
    setBusy(true);
    try {
      const restored = await api.restoreDefaultRates();
      setRates(restored);
      setCatalog(await api.getRateCatalog());
      setRateSearch("");
      setMsg(`Starter Rate Master restored: ${restored.length} total rate rows available.`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not restore starter rates.");
    } finally {
      setBusy(false);
    }
  };

  const filteredRates = rates.filter((rate) => {
    const tabOk = rateTab === "ALL" || rate.category === rateTab;
    const q = rateSearch.trim().toLowerCase();
    const searchOk = !q || `${rate.name} ${rate.grade} ${rate.unit}`.toLowerCase().includes(q);
    return tabOk && searchOk;
  });

  const updateRateLocal = (id: string, patch: Partial<RateItem>) => {
    setRates((current) => current.map((rate) => rate.id === id ? { ...rate, ...patch } : rate));
  };

  const saveRateRow = async (rate: RateItem) => {
    try {
      const saved = await api.updateRate(rate);
      const nextRates = rates.map((item) => item.id === saved.id ? saved : item);
      setRates(nextRates);
      await reflectRateMasterInSheet(nextRates);
      setMsg(`${saved.name}${saved.grade ? ` / ${saved.grade}` : ""} saved and applied to linked costing rows.`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Rate save failed.");
    }
  };

  const removeRate = async (id: string) => {
    try {
      await api.deleteRate(id);
      setRates((current) => current.filter((rate) => rate.id !== id));
      setMsg("Rate removed.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  const materialNames = Object.keys(catalog?.materials || {});

  const processOptions = Array.from(new Set([
    ...(catalog?.processes || []),
    ...rates.filter((rate) => rate.category === "PROCESS").map((rate) => rate.name)
  ].filter(Boolean)));

  const labourOptions = Array.from(new Set([
    ...(catalog?.labour || []),
    ...rates.filter((rate) => rate.category === "LABOUR").map((rate) => rate.name)
  ].filter(Boolean)));

  const otherOptions = Array.from(new Set(
    rates
      .filter((rate) => rate.category === "OTHER")
      .map((rate) => rate.name)
      .filter(Boolean)
  ));

  const materialUnitOptions = Array.from(new Set([
    draftRate.category === "MATERIAL" ? draftRate.unit : "",
    "kg", "g", "ton", "sheet", "piece"
  ].filter(Boolean)));

  const processUnitOptions = Array.from(new Set([
    draftRate.category === "PROCESS" ? draftRate.unit : "",
    "sec", "min", "hr"
  ].filter(Boolean)));

  const labourUnitOptions = Array.from(new Set([
    draftRate.category === "LABOUR" ? draftRate.unit : "",
    "sec", "min", "hr", "day", "shift", "part-time", "overtime"
  ].filter(Boolean)));

  const otherUnitOptions = Array.from(new Set([
    draftRate.category === "OTHER" ? draftRate.unit : "",
    "job", "each", "piece"
  ].filter(Boolean)));

  const unitOptions =
    draftRate.category === "MATERIAL"
      ? materialUnitOptions
      : draftRate.category === "PROCESS"
        ? processUnitOptions
        : draftRate.category === "LABOUR"
          ? labourUnitOptions
          : draftRate.category === "COMMERCIAL"
            ? ["%"]
            : otherUnitOptions;

  const rateRowUnitOptions = (rate: RateItem) =>
    Array.from(new Set([
      rate.unit,
      ...(rate.category === "MATERIAL"
        ? ["kg", "g", "ton", "sheet", "piece"]
        : rate.category === "PROCESS"
          ? ["sec", "min", "hr"]
          : rate.category === "LABOUR"
            ? ["sec", "min", "hr", "day", "shift", "part-time", "overtime"]
            : rate.category === "COMMERCIAL"
              ? ["%"]
              : ["job", "each", "piece"])
    ].filter(Boolean)));

  const gradeOptions = draftRate.category === "MATERIAL"
    ? Array.from(new Set([
        ...(catalog?.materials[draftRate.name] || []),
        draftRate.grade !== "__CUSTOM__" ? draftRate.grade : ""
      ].filter(Boolean)))
    : [];

  const startCustomRateOption = (
    field: "material" | "process" | "labour" | "other" | "unit"
  ) => {
    setCustomRateField(field);
    setCustomRateValue("");
  };

  const confirmCustomRateOption = () => {
    const value = customRateValue.trim();
    if (!value || !customRateField) return;

    if (customRateField === "unit") {
      setDraftRate((current) => ({ ...current, unit: value }));
    } else if (customRateField === "material") {
      setDraftRate((current) => ({
        ...current,
        name: value,
        grade: "__CUSTOM__"
      }));
      setCustomGrade("");
    } else {
      setDraftRate((current) => ({ ...current, name: value }));
    }

    setCustomRateField(null);
    setCustomRateValue("");
  };

  const reflectRateMasterInSheet = async (nextRates?: RateItem[]) => {
    try {
      if (rows.length) {
        const linked = await api.applySavedRates(rows);
        await recalc(linked);
      }

      const nextCatalog = await api.getRateCatalog();
      setCatalog(nextCatalog);

      if (nextRates) {
        setRates(nextRates);
      }
    } catch (error) {
      setMsg(
        error instanceof Error
          ? `Rate saved, but sheet refresh failed: ${error.message}`
          : "Rate saved, but sheet refresh failed."
      );
    }
  };

  const addRate = async () => {
    const grade = draftRate.grade === "__CUSTOM__" ? customGrade.trim() : draftRate.grade;
    const payload: RateItem = { ...draftRate, grade };
    if (!payload.name.trim()) return setMsg("Enter/select an item name.");
    if (payload.category === "MATERIAL" && !payload.grade.trim()) return setMsg("Select or enter a material grade.");
    if (!payload.unit.trim()) return setMsg("Enter a unit.");
    try {
      const saved = await api.addRate(payload);
      const nextRates = [...rates, saved];
      setRates(nextRates);
      await reflectRateMasterInSheet(nextRates);
      setDraftRate(blankRate());
      setCustomGrade("");
      setCustomRateField(null);
      setCustomRateValue("");
      setShowAddRate(false);
      setRateTab(saved.category);
      setMsg("New rate added. It is now available to automatic costing and sheet dropdowns.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not add rate.");
    }
  };

  const hasActiveDrawing =
    Boolean(file)
    || files.length > 0
    || Boolean(analysis)
    || batchItems.length > 0;

  const engineeringArtifactStage: "red" | "yellow" | "green" =
    !hasActiveDrawing
      ? "red"
      : step >= 3 && rows.length > 0
        ? "green"
        : "yellow";

  const saveCurrentWorkspaceNow = async (navigationView: View = view) => {
    const activeBatch = batchItemsRef.current.length
      ? batchItemsRef.current.map((item) =>
          item.id === activeBatchId && analysis && drawing
            ? {
                ...item,
                file: file || item.file,
                analysis,
                drawing,
                rows,
                summary
              }
            : item
        )
      : batchItems;

    const snapshot: PersistedWorkflowDraft = {
      view: navigationView,
      step,
      file,
      files,
      batchItems: activeBatch,
      activeBatchId,
      quoteMode,
      analysis,
      drawing,
      rows,
      summary,
      finalPriceOverride,
      commercialAmountOverrides,
      customer,
      modelFile,
      sourceFiles,
      activeSourceKey,
      datasetId: workspaceDatasetId,
      datasetName: workspaceDatasetName,
      batchFailures,
      dfmReports,
      bomReports,
      selectedDfmId,
      selectedBomId,
      savedAt: new Date().toISOString()
    };

    await Promise.all([
      saveWorkflowDraft(snapshot),
      saveWorkspaceDataset(snapshot)
    ]);

    saveWorkspaceToDatabase(snapshot);
  };

  const openEngineeringArtifact = (target: "dfm" | "bom") => {
    const activeWorkspace = batchItemsRef.current.find(
      (item) => item.id === activeBatchId
    );

    if (activeWorkspace) {
      if (target === "dfm") {
        const matching = dfmReports.find(
          (report) =>
            report.file_hash === activeWorkspace.analysis.file_hash
        );

        if (matching) setSelectedDfmId(matching.id);
      } else {
        const matching = bomReports.find(
          (report) =>
            report.file_hash === activeWorkspace.analysis.file_hash
        );

        if (matching) setSelectedBomId(matching.id);
      }
    }

    // Save exact source/review/cost state before leaving the workflow.
    void saveCurrentWorkspaceNow(view === "workflow" ? "workflow" : view)
      .catch(() => undefined)
      .finally(() => setView(target));
  };

  const restoreWorkspaceDataset = async (datasetId: string) => {
    const saved = await loadWorkspaceDataset(datasetId);
    if (!saved) return;

    applyPersistedWorkflow(saved, true);
    setMsg(
      `${saved.datasetName || "Workspace dataset"} restored. Last saved ${
        saved.savedAt ? new Date(saved.savedAt).toLocaleString() : ""
      }.`
    );
    await saveWorkflowDraft(saved);
  };

  const removeWorkspaceDataset = async (datasetId: string) => {
    if (!window.confirm("Delete this saved workspace dataset?")) return;
    await deleteWorkspaceDataset(datasetId);
    await refreshWorkspaceDatasets();
  };

  const saveWorkspaceToDatabase = (snapshot: PersistedWorkflowDraft) => {
    const payload: Record<string, unknown> = {
      view: snapshot.view,
      step: snapshot.step,
      activeBatchId: snapshot.activeBatchId,
      quoteMode: snapshot.quoteMode,
      analysis: snapshot.analysis,
      drawing: snapshot.drawing,
      rows: snapshot.rows,
      summary: snapshot.summary,
      customer: snapshot.customer,
      datasetId: snapshot.datasetId,
      datasetName: snapshot.datasetName,
      dfmReports: snapshot.dfmReports,
      bomReports: snapshot.bomReports,
      savedAt: snapshot.savedAt,
      files: (snapshot.files || []).map((item) => ({
        name: item.name,
        size: item.size,
        type: item.type,
        lastModified: item.lastModified
      })),
      sourceFiles: (snapshot.sourceFiles || []).map((item) => ({
        name: item.name,
        size: item.size,
        type: item.type,
        lastModified: item.lastModified
      })),
      activeSourceKey: snapshot.activeSourceKey || "",
      modelFile: snapshot.modelFile
        ? {
            name: snapshot.modelFile.name,
            size: snapshot.modelFile.size,
            type: snapshot.modelFile.type,
            lastModified: snapshot.modelFile.lastModified
          }
        : null
    };

    void api.saveWorkspaceSession(
      snapshot.datasetId,
      snapshot.datasetName,
      payload
    ).catch(() => undefined);
  };

  const modelSourceExtensions = useMemo(
    () => new Set([
      "step", "stp", "glb", "gltf", "stl", "obj",
      "iges", "igs", "x_t", "x_b"
    ]),
    []
  );

  const isModelSource = (selected: File) =>
    isVisualCadFormat(selected);

  const allSourceFiles = sourceFiles.length
    ? sourceFiles
    : [
        ...files,
        ...(modelFile ? [modelFile] : [])
      ];

  const activeSource =
    allSourceFiles.find((selected) => fileKey(selected) === activeSourceKey)
    || allSourceFiles[0]
    || null;

  const selectedDfm = dfmReports.find((item) => item.id === selectedDfmId) || dfmReports.at(-1) || null;
  const selectedBom = bomReports.find((item) => item.id === selectedBomId) || bomReports.at(-1) || null;

  const selectedDfmWorkspace = selectedDfm
    ? batchItems.find(
        (item) =>
          item.analysis.file_hash === selectedDfm.file_hash
      )
    : null;

  const selectedDfmSourceFile = selectedDfmWorkspace?.file || null;
  const selectedDfmHas3D =
    Boolean(selectedDfmSourceFile && isModelSource(selectedDfmSourceFile));

  const dfmProcessingCount = Object.values(dfmJobs).filter((value) => value === "processing").length;
  const bomProcessingCount = Object.values(bomJobs).filter((value) => value === "processing").length;

  const selectedDfmPassCount = selectedDfm?.checks.filter((item) => item.result === "PASS").length || 0;
  const selectedDfmReviewCount = selectedDfm?.checks.filter((item) => item.result === "REVIEW").length || 0;
  const selectedDfmFailCount = selectedDfm?.checks.filter((item) => item.result === "FAIL").length || 0;
  const selectedDfmAttentionCount = selectedDfmReviewCount + selectedDfmFailCount;

  const selectedBomMaterialCount = selectedBom?.items.filter((item) =>
    item.category === "Raw Material" || item.category === "Manufactured Part"
  ).length || 0;

  const selectedBomStandardCount = selectedBom?.items.filter((item) =>
    item.category === "Standard Part" || item.category === "Purchased Part"
  ).length || 0;

  const selectedBomMissingCount = selectedBom?.items.filter((item) =>
    !String(item.description || "").trim()
    || !String(item.unit || "").trim()
    || Number(item.quantity || 0) <= 0
    || (
      item.category === "Raw Material"
      && !String(item.material || "").trim()
    )
  ).length || 0;

  const selectedBomTotalCost = selectedBom?.items.reduce(
    (sum, item) => sum + Number(item.total_cost || 0),
    0
  ) || 0;

  const updateDfm = (next: DfmReport) => {
    setDfmReports((current) => current.map((item) => item.id === next.id ? next : item));
  };

  const updateBom = (next: BomReport) => {
    setBomReports((current) => current.map((item) => item.id === next.id ? next : item));
  };

  const renameDfm = (report: DfmReport) => {
    const name = window.prompt("Rename DFM report", report.name)?.trim();
    if (name) updateDfm({ ...report, name });
  };

  const renameBom = (report: BomReport) => {
    const name = window.prompt("Rename BOM", report.name)?.trim();
    if (name) updateBom({ ...report, name });
  };

  const deleteDfm = (report: DfmReport) => {
    if (!window.confirm(`Delete "${report.name}"?`)) return;
    setDfmReports((current) => current.filter((item) => item.id !== report.id));
    if (selectedDfmId === report.id) setSelectedDfmId("");
  };

  const deleteBom = (report: BomReport) => {
    if (!window.confirm(`Delete "${report.name}"?`)) return;
    setBomReports((current) => current.filter((item) => item.id !== report.id));
    if (selectedBomId === report.id) setSelectedBomId("");
  };

  useEffect(() => {
    if (step !== 3 || view !== "workflow" || !drawing || !analysis) return;
    const timer = window.setTimeout(() => { void refreshPremiumEstimate(); }, 180);
    return () => window.clearTimeout(timer);
  }, [step, view, drawing?.drawing_no, drawing?.revision, rows.length, analysis?.extraction_id, refreshPremiumEstimate]);

  useEffect(() => {
    let active = true;
    api.getPremiumKpis().then((value) => { if (active) setPremiumKpis(value); }).catch(() => {});
    return () => { active = false; };
  }, [quotes.length]);

  const materialCalcVolume = materialVolumeMm3(materialCalculator);
  const materialCalcUnitWeight = materialCalcVolume * Math.max(0, materialCalculator.densityKgM3) / 1_000_000_000;
  const materialCalcGeometricWeight = materialCalcUnitWeight * Math.max(0, materialCalculator.quantity);
  const materialCalcPredictedBaseWeight = materialCalculator.predictedBaseWeightKg > 0
    ? materialCalculator.predictedBaseWeightKg
    : (materialCalculator.predictedTotalWeightKg > 0 ? Math.max(0, materialCalculator.predictedTotalWeightKg - 1) : 0);
  const materialCalcTotalWeight = materialCalcPredictedBaseWeight > 0
    ? materialCalcPredictedBaseWeight + Math.max(0, materialCalculator.allowanceKg)
    : (materialCalcGeometricWeight > 0 ? materialCalcGeometricWeight + Math.max(0, materialCalculator.allowanceKg) : 0);
  const materialCalcAmount = materialCalcTotalWeight * Math.max(0, materialCalculator.pricePerKg);

  return (
    <main className={`app ${sideOpen ? "" : "sidebar-collapsed"}`}>
      <aside className={`side ${sideOpen ? "" : "closed"}`}>
        <div className="sidebar-brand-row">
          <div className="brand">
            <span className="dfab-logo-placeholder" aria-label="DFAB logo placeholder">
              <img
                src="/dfab-logo.png"
                alt="DFAB Logo"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <em>DFAB</em>
            </span>
            <div><b>AI Quotation</b><small>Manufacturing Costing</small></div>
          </div>
          <button
            className="sidebar-toggle sidebar-toggle-inline"
            type="button"
            onClick={() => setSideOpen(false)}
            title="Close menu"
            aria-label="Close menu"
          >
            ‹
          </button>
        </div>
        <nav>
          <button type="button" className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
          <div className="new-quotation-nav-row">
            <button type="button" className="new-quotation-nav-main" onClick={newQuote}>New Quotation</button>
            <button
              type="button"
              className="resume-quotation-diamond"
              onClick={() => void resumeWorkingQuotation()}
              title="Resume working quotation"
              aria-label="Resume working quotation"
            >
              <span>◆</span>
            </button>
          </div>
          <button type="button" className={view === "quotes" ? "active" : ""} onClick={() => setView("quotes")}>Quotation History</button>
          <button type="button" className={view === "rates" ? "active" : ""} onClick={openRates}>Rate Master</button>
          <button type="button" className={view === "dfm" ? "active" : ""} onClick={() => openEngineeringArtifact("dfm")}>
            <span>DFM Report</span>
            <span className="artifact-nav-meta">
              <i className={`artifact-nav-light ${engineeringArtifactStage}`}/>
              <em>{dfmReports.length}</em>
            </span>
          </button>
          <button type="button" className={view === "bom" ? "active" : ""} onClick={() => openEngineeringArtifact("bom")}>
            <span>BOM</span>
            <span className="artifact-nav-meta">
              <i className={`artifact-nav-light ${engineeringArtifactStage}`}/>
              <em>{bomReports.length}</em>
            </span>
          </button>
          <button type="button" className={view === "dataset" ? "active" : ""} onClick={() => { setView("dataset"); void refresh(); void refreshWorkspaceDatasets(); }}>Dataset Learning</button>
          <button
            type="button"
            className={`settings-nav-button ${view === "settings" ? "active" : ""}`}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
          <button
            type="button"
            className="theme-toggle-nav"
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            aria-pressed={theme === "dark"}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            <span>{theme === "dark" ? "Light Theme" : "Dark Theme"}</span>
          </button>
        </nav>
        <div className="learn">
          <b>Continuous Dataset</b>
          <small>{stats?.extractions ?? 0} extracted · {stats?.reviewed_samples ?? 0} reviewed</small>
        </div>
      </aside>

      <section className="content">
        {!sideOpen && (
          <button className="sidebar-open-btn" type="button" onClick={() => setSideOpen(true)} title="Open menu" aria-label="Open menu">☰</button>
        )}
        <header>
          <div>
            <p className="eyebrow">ENGINEERING AUTOMATION</p>
            <h1>{settings?.company_name || "AI Manufacturing Quotation"}</h1>
          </div>
          <button className="btn primary" onClick={newQuote}>+ New Quotation</button>
        </header>

        <div className="message" aria-live="polite">{msg}</div>

        {view === "dashboard" && (
          <section>
            <div className="cards four premium-dashboard-cards">
              <article><small>Total Quotations</small><b>{premiumKpis?.quotes ?? quotes.length}</b><span>{premiumKpis ? money(premiumKpis.total_value) : "Saved records"}</span></article>
              <article><small>Win Rate</small><b>{(premiumKpis?.win_rate ?? 0).toFixed(1)}%</b><span>{premiumKpis?.won ?? 0} won / accepted</span></article>
              <article><small>Estimator Learning</small><b>{premiumKpis?.actual_samples ?? stats?.training_samples ?? 0}</b><span>Actual-vs-quoted samples</span></article>
              <article><small>Rate Coverage</small><b>{rates.filter(r => r.active).length}</b><span>Active material/process/labour rates</span></article>
            </div>
            <div className="panel">
              <div className="heading row">
                <div><p className="eyebrow">START</p><h2>Drawing → Costing → Quotation</h2><p>Cost rows pull rates and criticality directly from the Rate Master.</p></div>
                <button className="btn primary" onClick={newQuote}>Upload New Drawing</button>
              </div>
              <Recent
                quotes={quotes}
                onRename={renameSavedQuote}
                onDelete={deleteSavedQuote}
              />
            </div>
          </section>
        )}

        {view === "workflow" && (
          <>
            <div className="steps">
              {["Upload", "Drawing Review", "Cost Sheet", "Quotation"].map((label, i) => (
                <button
                  key={label}
                  className={`step ${step === i + 1 ? "current" : ""} ${step > i + 1 ? "done" : ""}`}
                  onClick={() => goWorkflowStep(i + 1)}
                >
                  <span>{step > i + 1 ? "✓" : i + 1}</span>{label}
                </button>
              ))}
            </div>

            {allSourceFiles.length > 0 && step >= 2 && (
              <div className="drawing-selector-box source-overview-box">
                <div className="drawing-selector-title">
                  <div>
                    <span>SOURCE OVERVIEW</span>
                    <b>
                      {batchItems.length}/{allSourceFiles.length} source file{
                        allSourceFiles.length === 1 ? "" : "s"
                      } analyzed · {allSourceFiles.length} total source file{
                        allSourceFiles.length === 1 ? "" : "s"
                      }
                    </b>
                  </div>

                  <div className="batch-selector-actions">

                    {batchFailures.length > 0 && (
                      <button
                        type="button"
                        className="retry-failed-btn"
                        disabled={busy}
                        onClick={retryFailedDrawings}
                      >
                        {busy
                          ? "Retrying..."
                          : `Retry Failed (${batchFailures.length})`}
                      </button>
                    )}

                    <button
                      type="button"
                      className="end-process-btn"
                      disabled={busy}
                      onClick={() => void deleteOngoingQuotation()}
                    >
                      End Process
                    </button>
                  </div>
                </div>

                <div className="drawing-selector-list source-selector-list">
                  {allSourceFiles.map((selected, index) => {
                    const sourceKey = fileKey(selected);
                    const model = isModelSource(selected);

                    const batchItem = batchItems.find(
                      (item) => fileKey(item.file) === sourceKey
                    );

                    const failure = batchFailures.find(
                      (item) => fileKey(item.file) === sourceKey
                    );

                    const extension =
                      selected.name.split(".").pop()?.toUpperCase() || "FILE";
                    const sourceIntelligence =
                      batchItem?.analysis.engineering_intelligence
                      || batchItem?.analysis.ai_raw?.engineering_intelligence;
                    const sourceClass = sourceIntelligence?.document_type
                      ? sourceIntelligence.document_type.replace(" Drawing", "")
                      : "";
                    const sourceRoute = sourceIntelligence?.primary_manufacturing_type || "";

                    return (
                      <button
                        key={sourceKey}
                        type="button"
                        className={`${sourceKey === activeSourceKey ? "active" : ""} ${model ? "source-model" : ""}`}
                        onClick={() => {
                          setActiveSourceKey(sourceKey);

                          if (batchItem) {
                            selectBatchDrawing(batchItem.id);
                          }
                        }}
                      >
                        <small>{index + 1}/{allSourceFiles.length}</small>

                        <b>
                          {batchItem?.drawing.drawing_no
                            || selected.name.replace(/\.[^.]+$/, "")}
                        </b>

                        <span>
                          {failure
                            ? `${extension} · Failed`
                            : batchItem
                              ? batchItem.analysis.learning_source === "independent_fallback"
                                ? `${extension} · Review Required`
                                : sourceClass || sourceRoute
                                  ? `${sourceClass || "Part"} · ${sourceRoute || "Analyzed"} · T ${engineeringMetricOrDash(batchItem.drawing.thickness_mm, 1, "mm")} · W ${engineeringMetricOrDash(batchItem.drawing.weight_kg, 2, "kg")}`
                                  : model
                                    ? `${extension} · CAD Analyzed · T ${engineeringMetricOrDash(batchItem.drawing.thickness_mm, 1, "mm")} · W ${engineeringMetricOrDash(batchItem.drawing.weight_kg, 2, "kg")}`
                                    : `${extension} · Analyzed · T ${engineeringMetricOrDash(batchItem.drawing.thickness_mm, 1, "mm")} · W ${engineeringMetricOrDash(batchItem.drawing.weight_kg, 2, "kg")}`
                              : `${extension} · Ready`}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {activeSource && isModelSource(activeSource) && (
                  <div className="source-cad-overview">
                    <span>3D/CAD SOURCE</span>

                    <div>
                      <b>{activeSource.name}</b>
                      <small>
                        {(activeSource.name.split(".").pop() || "CAD").toUpperCase()}
                        {" · "}
                        {(activeSource.size / 1024 / 1024).toFixed(2)} MB
                        {" · "}
                        Independent CAD source
                      </small>
                    </div>

                    <i>✓ Independent</i>
                  </div>
                )}

                {batchFailures.length > 0 && (
                  <div className="failed-drawing-strip">
                    {batchFailures.map((failure, index) => (
                      <div key={`${failure.file.name}-${index}`}>
                        <span>!</span>
                        <b>{failure.file.name}</b>
                        <small title={failure.error}>
                          Analysis failed · retry required
                        </small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <section className="panel">
                <div className="heading"><p className="eyebrow">STEP 1</p><h2>Upload Engineering Drawing</h2><p>Every extraction can be captured automatically as a dataset sample.</p></div>
                <label className="upload">
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.dxf,.dwg,.step,.stp,.glb,.gltf,.stl,.obj,.iges,.igs,.x_t,.x_b"
                    onChange={(e) => {
                      const selectedInputs = Array.from(e.target.files || []);

                      const modelExtensions = new Set([
                        "step", "stp", "glb", "gltf", "stl", "obj",
                        "iges", "igs", "x_t", "x_b"
                      ]);

                      const selectedModels = selectedInputs.filter((selected) => {
                        const ext = selected.name.split(".").pop()?.toLowerCase() || "";
                        return modelExtensions.has(ext);
                      });

                      const selectedDrawings = selectedInputs.filter((selected) => {
                        const ext = selected.name.split(".").pop()?.toLowerCase() || "";
                        return !modelExtensions.has(ext);
                      });

                      // Preserve ALL mixed files across repeated chooser actions.
                      // STEP first + PDF later => both remain visible in this session.
                      const sourceMap = new Map(
                        sourceFiles.map((existing) => [
                          `${existing.name}-${existing.size}-${existing.lastModified}`,
                          existing
                        ])
                      );

                      selectedInputs.forEach((selected) => {
                        sourceMap.set(
                          `${selected.name}-${selected.size}-${selected.lastModified}`,
                          selected
                        );
                      });

                      const nextSourceFiles = Array.from(sourceMap.values());

                      // Only PDF/Image/DXF/DWG-style files go through drawing analysis.
                      // CAD/STEP sources are separately stored and linked to DFM.
                      const drawingMap = new Map(
                        files.map((existing) => [
                          `${existing.name}-${existing.size}-${existing.lastModified}`,
                          existing
                        ])
                      );

                      selectedDrawings.forEach((selected) => {
                        drawingMap.set(
                          `${selected.name}-${selected.size}-${selected.lastModified}`,
                          selected
                        );
                      });

                      const nextDrawingFiles = Array.from(drawingMap.values());
                      const nextModel = selectedModels.at(-1) || modelFile || null;
                      const nextFile = nextDrawingFiles[0] || null;

                      setSourceFiles(nextSourceFiles);
                      setFiles(nextDrawingFiles);
                      setFile(nextFile);
                      setModelFile(nextModel);

                      if (!activeSourceKey && nextSourceFiles[0]) {
                        setActiveSourceKey(fileKey(nextSourceFiles[0]));
                      }

                      // Instant UI response: file is accepted immediately.
                      // Original file database storage runs in background and does
                      // not keep Analyze Drawing disabled.
                      selectedInputs.forEach((selected) => {
                        const ext = selected.name.split(".").pop()?.toLowerCase() || "";
                        const role = modelExtensions.has(ext) ? "model" : "drawing";
                        const key = `${selected.name}-${selected.size}-${selected.lastModified}`;

                        setUploadedFileStatus((current) => ({
                          ...current,
                          [key]: "uploading"
                        }));

                        // Persist original files without blocking selection/analyze.
                        // Reflect the real database state instead of marking success
                        // before the request has completed.
                        window.setTimeout(() => {
                          void api
                            .uploadWorkspaceFile(
                              workspaceDatasetId,
                              selected,
                              role
                            )
                            .then(() => {
                              setUploadedFileStatus((current) => ({
                                ...current,
                                [key]: "uploaded"
                              }));
                            })
                            .catch((error) => {
                              setUploadedFileStatus((current) => ({
                                ...current,
                                [key]: "failed"
                              }));
                              setMsg(error instanceof Error
                                ? `File selected and ready to analyze, but database sync failed: ${error.message}`
                                : "File selected and ready to analyze, but database sync failed.");
                            });
                        }, 0);
                      });

                      if (selectedDrawings.length > 0) {
                        const sourceName = selectedDrawings[0].name.replace(/\.[^.]+$/, "");

                        if (!file && !files.length) {
                          setWorkspaceDatasetName(`Dataset - ${sourceName}`);
                        }

                        // New 2D drawing requires a new analysis pass, but CAD files
                        // already uploaded to this same session are preserved.
                        setBatchItems([]);
                        batchItemsRef.current = [];
                        setBatchFailures([]);
                        setActiveBatchId("");
                        setAnalysis(null);
                        setDrawing(null);
                        setRows([]);
                        setSummary(emptySummary);
                      }

                      setMsg(
                        selectedInputs.length
                          ? `${nextSourceFiles.length} source file${
                              nextSourceFiles.length === 1 ? "" : "s"
                            } uploaded · ${nextDrawingFiles.length} drawing file${
                              nextDrawingFiles.length === 1 ? "" : "s"
                            } drawing file${
                              nextDrawingFiles.length === 1 ? "" : "s"
                            } · all ${nextSourceFiles.length} source file${
                              nextSourceFiles.length === 1 ? "" : "s"
                            } will be analyzed independently.`
                          : "Upload a drawing to begin."
                      );

                      e.target.value = "";
                    }}
                  />
                  <span>↑</span>
                  <b>
                    {allSourceFiles.length
                      ? `${allSourceFiles.length} source file${
                          allSourceFiles.length === 1 ? "" : "s"
                        } selected`
                      : "Choose drawing(s)"}
                  </b>
                  <small>
                    PDF / Image / DXF / DWG / STEP / STP / GLB / GLTF / STL / OBJ / IGES / Parasolid
                  </small>
                </label>

                {allSourceFiles.length > 0 && (
                  <div className="uploaded-source-list">
                    {allSourceFiles.map((selected, index) => {
                      const key = `${selected.name}-${selected.size}-${selected.lastModified}`;
                      const status = uploadedFileStatus[key] || "uploaded";
                      const model = isModelSource(selected);

                      return (
                        <div
                          className={`uploaded-source-card ${model ? "model" : ""} ${status}`}
                          key={key}
                        >
                          <span className="uploaded-source-check">
                            {status === "failed" ? "!" : "✓"}
                          </span>

                          <div>
                            <b>{selected.name}</b>
                            <small>
                              Source {index + 1}/{allSourceFiles.length} · {(selected.name.split(".").pop() || "FILE").toUpperCase()}
                              {model ? " · 3D/CAD · independent quotation source" : " · drawing · independent quotation source"}
                              {" · "}
                              {(selected.size / 1024 / 1024).toFixed(2)} MB
                            </small>
                          </div>

                          <div className="uploaded-source-actions">
                            <em>
                              {status === "failed" ? "DB sync failed" : status === "uploading" ? "Saving…" : "Uploaded"}
                            </em>
                            <button
                              type="button"
                              className="uploaded-source-remove"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                removeUploadedSource(selected);
                              }}
                              title={`Remove ${selected.name}`}
                              aria-label={`Remove ${selected.name}`}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {busy && (
                  <div className="drawing-analyze-loader" role="status" aria-live="polite">
                    <div className="loader-gear" aria-hidden="true">
                      <span/><span/><span/>
                    </div>
                    <div>
                      <b>Analyzing…</b>
                      <span>Reading engineering data and preparing output</span>
                    </div>
                    <div className="loader-track"><i/></div>
                  </div>
                )}

                <div className="actions">
                  <button
                    className="btn primary"
                    disabled={allSourceFiles.length === 0 || busy}
                    onClick={analyze}
                  >
                    {busy
                      ? "Analyzing…"
                      : allSourceFiles.length > 1
                        ? `Analyze ${allSourceFiles.length} Sources`
                        : allSourceFiles.length === 1
                          ? "Analyze Source"
                          : "Add Source to Analyze"}
                  </button>
                </div>
              </section>
            )}

            {step === 2 && drawing && (
              <section className="panel">
                <div className="heading row">
                  <div><p className="eyebrow">STEP 2</p><h2>Drawing Snapshot & Basic Details</h2><p>Confirm the drawing identity and key values. Full engineering details stay in the Excel sheet.</p></div>
                  <div className="actions compact">
                    <button className="btn secondary" disabled={busy || !drawing.drawing_no} onClick={() => void comparePreviousRevision()}>Compare Previous</button>
                    <button className="btn primary" disabled={busy} onClick={saveReview}>Save Review & Continue</button>
                  </div>
                </div>
                <div className="extraction-status">
                  <span className={`source-badge ${["vision_ai", "vision_ai_image", "cad_geometry", "reviewed_memory", "dxf_geometry"].includes(analysis?.learning_source || "") ? "good" : "warn"}`}>
                    Source: {analysis?.learning_source || "unknown"}
                  </span>
                  {analysis?.extraction_warnings?.map((warning, i) => (
                    <span className="extract-warning" key={i}>⚠ {warning}</span>
                  ))}
                </div>

                {(analysis?.engineering_intelligence || analysis?.ai_raw?.engineering_intelligence) && (() => {
                  const intel = analysis?.engineering_intelligence || analysis?.ai_raw?.engineering_intelligence;
                  const completeness = intel?.completeness;
                  return (
                    <div className="engineering-classification-ribbon">
                      <div>
                        <small>DOCUMENT</small>
                        <b>{intel?.document_type || "Part Drawing"}</b>
                      </div>
                      <div>
                        <small>MANUFACTURING</small>
                        <b>{intel?.primary_manufacturing_type || "Review Required"}</b>
                      </div>
                      <div>
                        <small>PART FORM</small>
                        <b>{intel?.part_form || "Unknown"}</b>
                      </div>
                      <div>
                        <small>CLASSIFICATION</small>
                        <b>{Number(intel?.classification_confidence || 0)}%</b>
                      </div>
                      <div className={`release-${String(completeness?.release_state || "REVIEW").toLowerCase()}`}>
                        <small>ENGINEERING DATA</small>
                        <b>{Number(completeness?.engineering_data || 0)}%</b>
                      </div>
                    </div>
                  );
                })()}

                {revisionComparison && (
                  <div className={`revision-compare-panel ${revisionComparison.available ? "available" : "empty"}`}>
                    <div>
                      <span>REVISION COMPARISON</span>
                      <b>{revisionComparison.available
                        ? `${revisionComparison.baseline_revision || "Previous"} → ${revisionComparison.current_revision || "Current"}`
                        : "No previous revision"}</b>
                    </div>
                    {revisionComparison.available && (
                      <>
                        <strong>{revisionComparison.changes.length} change{revisionComparison.changes.length === 1 ? "" : "s"}</strong>
                        <em className={revisionComparison.cost_delta > 0 ? "increase" : revisionComparison.cost_delta < 0 ? "decrease" : "same"}>
                          Cost Δ {money(revisionComparison.cost_delta)}
                        </em>
                        <div className="revision-change-list">
                          {revisionComparison.changes.slice(0, 6).map((change, index) => (
                            <span key={`${change.field}-${index}`}>
                              <b>{change.field}</b>
                              <small>{String(change.previous ?? "—")} → {String(change.current ?? "—")}</small>
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="review">
                  <div className="paperbox">
                    <div className="drawing-snapshot">
                      {fileUrl && file?.type === "application/pdf"
                        ? (
                          <iframe
                            src={`${fileUrl}#toolbar=0&navpanes=0&view=FitH`}
                            title="Uploaded engineering drawing"
                          />
                        )
                        : fileUrl && file && file.type.startsWith("image/")
                          ? <img src={fileUrl} alt="Uploaded drawing"/>
                          : analysis?.preview_image
                            ? <img src={analysis.preview_image} alt="Drawing snapshot"/>
                            : (
                              <div className="drawing-outline" aria-label="Drawing outline preview">
                                <div className="outline-title">DRAWING PREVIEW</div>
                                <div className="outline-main">
                                  <i/><i/><i/><i/>
                                </div>
                                <div className="outline-titleblock">
                                  <span>{drawing.drawing_no || "Drawing No."}</span>
                                  <span>{drawing.revision || "Rev"}</span>
                                </div>
                              </div>
                            )}
                    </div>
                    <div className="snapshot-caption">
                      <b>Drawing Snapshot</b>
                      <span>{file?.name || drawing.description}</span>
                    </div>
                  </div>

                  <div className="basic-review-form">
                    <label><span>Drawing No.</span><input value={drawing.drawing_no} onChange={(e) => setDrawing({ ...drawing, drawing_no: e.target.value })}/></label>
                    <label><span>Revision</span><input value={drawing.revision} onChange={(e) => setDrawing({ ...drawing, revision: e.target.value })}/></label>
                    <label><span>Description</span><input value={drawing.description} onChange={(e) => setDrawing({ ...drawing, description: e.target.value })}/></label>
                    <label><span>Material</span><input value={drawing.material} onChange={(e) => setDrawing({ ...drawing, material: e.target.value })}/></label>
                    <label><span>Thickness</span><div className="value-with-unit"><input type="number" step=".1" value={drawing.thickness_mm || ""} onChange={(e) => setDrawing({ ...drawing, thickness_mm: +e.target.value || 0 })}/><em>mm</em></div></label>
                    <label><span>Weight</span><div className="value-with-unit"><input type="number" step=".001" value={drawing.weight_kg} onChange={(e) => setDrawing({ ...drawing, weight_kg: +e.target.value })}/><em>kg</em></div></label>
                    <label><span>Product Qty</span><input type="number" min="1" value={drawing.quantity} onChange={(e) => setDrawing({ ...drawing, quantity: +e.target.value })}/></label>

                    <div className="analysis-one-line">
                      <span>Analyzed</span>
                      <b title={compactAnalysisLine(analysis?.ai_raw)}>
                        {compactAnalysisLine(analysis?.ai_raw)}
                      </b>
                    </div>
                  </div>
                </div>

              </section>
            )}

            {step === 3 && drawing && (
              <section className="panel">
                <div className="heading row">
                  <div><p className="eyebrow">STEP 3</p><h2>Engineering & Cost Sheet</h2><p>Edit each extracted table directly. Tables are arranged one-by-one in a single vertical sheet.</p></div>
                  <div className="actions compact">
                    <button className="btn secondary" disabled={busy} onClick={refreshCostRates}>↻ Refresh Saved Rates</button>
                    <button className="btn secondary" onClick={() => api.exportExcel(drawing, rows, summary)}>Export Excel</button>
                    <button
                      className="btn primary"
                      disabled={batchFailures.length > 0}
                      onClick={() => goWorkflowStep(4)}
                      title={
                        batchFailures.length > 0
                          ? "Retry failed drawings before preparing quotation"
                          : "Prepare quotation"
                      }
                    >
                      Continue
                    </button>
                  </div>
                </div>
                <div className="sheet-details-header">
                  <div>
                    <p className="eyebrow">EXTRACTED DRAWING SHEET</p>
                    <h3>Engineering Details</h3>
                    <p>Every extracted section is a full-width editable table. Add, correct or remove rows before final costing.</p>
                  </div>
                </div>

                <EngineeringDetails data={analysis?.ai_raw || null} onChange={updateEngineeringData}/>

                <div className="sheet-status-legend">
                  <span><i className="sheet-dot green"/>Ready</span>
                  <span><i className="sheet-dot yellow"/>Review</span>
                  <span><i className="sheet-dot red"/>Attention</span>
                  <b>Feature tables use status; classification and evidence show confidence.</b>
                </div>
                <div className="charge-cards">
                  <div><span>Material Charges</span><b>{money(chargeTotals.material)}</b></div>
                  <div><span>Processing Charges</span><b>{money(chargeTotals.process)}</b></div>
                  <div><span>Labour Charges</span><b>{money(chargeTotals.labour)}</b></div>
                </div>

                {rows.length ? (
                  <div className="cost-trace-panel">
                    <div className="cost-trace-head">
                      <div><span>COST TRACEABILITY</span><b>Live quantity × rate explanation</b></div>
                      <small>{rows.length} rows</small>
                    </div>
                    <div className="cost-trace-list">
                      {rows.slice(0, 8).map((item) => (
                        <div key={item.id || `${item.category}-${item.item}`}>
                          <span>{item.category}</span>
                          <b>{item.item}</b>
                          <code>{Number(item.costingQty || 0)} {item.unit} × {money(Number(item.rate || 0))}/{item.unit || "unit"} = {money(Number(item.costingQty || 0) * Number(item.rate || 0))}</code>
                          <small>{item.rateSource || "Manual / Included"} · {item.confidence || "Review"}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="cost-grid-shell">
                  <div className="cost-grid-title">
                    <div><span>COSTING</span><b>Rate Master Cost Rows</b></div>
                    <div className="cost-grid-actions">
                      <small>All input fields are editable</small>
                      <button type="button" className="material-calc-open-btn" onClick={() => openMaterialCalculator()}>Material Weight & Cost</button>
                      <button type="button" className="table-add-btn" onClick={addCostRow}>+ Add Cost Row</button>
                    </div>
                  </div>
                  <div className="ag-theme-quartz grid neat-grid">
                  <AgGridReact<CostRow>
                    rowData={rows}
                    columnDefs={columns}
                    onCellValueChanged={onCostCellChanged}
                    getRowId={(p) => p.data.id}
                    defaultColDef={{ sortable: true, resizable: true }}
                  />
                </div></div>
                <SummaryView
                  summary={summary}
                  commercialAmountOverrides={commercialAmountOverrides}
                  finalPriceOverride={finalPriceOverride}
                  onChange={updateCommercial}
                />

                <PremiumEstimatorPanel
                  estimate={premiumEstimate}
                  busy={premiumBusy}
                  onRefresh={() => void refreshPremiumEstimate()}
                  onApplyProcesses={() => void applyPremiumProcessCosting()}
                  actualCost={actualCostDraft.actualCost}
                  actualHours={actualCostDraft.actualHours}
                  actualNotes={actualCostDraft.notes}
                  onActualCostChange={(value) => setActualCostDraft((current) => ({ ...current, actualCost: value }))}
                  onActualHoursChange={(value) => setActualCostDraft((current) => ({ ...current, actualHours: value }))}
                  onActualNotesChange={(value) => setActualCostDraft((current) => ({ ...current, notes: value }))}
                  onSaveActual={() => void recordActualPerformance()}
                  question={estimatorQuestion}
                  answer={estimatorAnswer}
                  onQuestionChange={setEstimatorQuestion}
                  onAsk={askEstimator}
                />

                {showMaterialCalculator && (
                  <div className="material-modal-backdrop" role="presentation" onMouseDown={(event) => {
                    if (event.currentTarget === event.target) setShowMaterialCalculator(false);
                  }}>
                    <div className="material-modal" role="dialog" aria-modal="true" aria-labelledby="material-calculator-title">
                      <div className="material-modal-head">
                        <div>
                          <p className="eyebrow">MATERIAL COST</p>
                          <h3 id="material-calculator-title">Product Size → Weight → Cost</h3>
                          <p>The system reads the drawing first, predicts thickness and material weight, then applies the editable material allowance and ₹/kg rate to the quotation. Edit any value if engineering review requires it.</p>
                        </div>
                        <button type="button" className="material-modal-close" aria-label="Close material calculator" onClick={() => setShowMaterialCalculator(false)}>×</button>
                      </div>

                      {(materialCalculator.predictedBaseWeightKg > 0 || materialCalculator.predictedTotalWeightKg > 0) && (
                        <div className="material-auto-prediction-box">
                          <div><span>Drawing thickness</span><b>{materialCalculator.thicknessMm > 0 ? `${materialCalculator.thicknessMm.toFixed(3)} mm` : "Not stated / not required for stated weight"}</b></div>
                          <div><span>Drawing material weight</span><b>{materialCalcPredictedBaseWeight.toFixed(3)} kg</b></div>
                          <div><span>+ Allowance</span><b>{Math.max(0, materialCalculator.allowanceKg).toFixed(3)} kg</b></div>
                          <div><span>Costing weight</span><b>{materialCalcTotalWeight.toFixed(3)} kg</b></div>
                          <small>{materialCalculator.predictionBasis}</small>
                        </div>
                      )}

                      {materialCalculatorMissing.length > 0 && (
                        <div className="material-missing-box" role="alert">
                          <b>Complete these fields before continuing:</b>
                          <span>{materialCalculatorMissing.join(" · ")}</span>
                        </div>
                      )}

                      <div className="material-shape-row">
                        <label>
                          <span>Shape</span>
                          <select value={materialCalculator.shape} onChange={(e) => {
                            setMaterialCalculator((current) => ({ ...current, shape: e.target.value as MaterialShape }));
                            setMaterialCalculatorMissing([]);
                          }}>
                            <option value="plate">Plate / Block</option>
                            <option value="round_bar">Round Bar / Rod</option>
                            <option value="pipe">Pipe / Circular Tube</option>
                            <option value="rect_tube">Square / Rectangular Tube</option>
                            <option value="angle">Angle</option>
                          </select>
                        </label>
                        <label>
                          <span>Product Quantity</span>
                          <input type="number" min="1" step="1" value={materialCalculator.quantity || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, quantity: Number(e.target.value) }))}/>
                        </label>
                        <label>
                          <span>Density</span>
                          <div className="material-input-unit"><input type="number" min="1" step="1" value={materialCalculator.densityKgM3 || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, densityKgM3: Number(e.target.value) }))}/><em>kg/m³</em></div>
                        </label>
                        <label>
                          <span>Material Price</span>
                          <div className="material-input-unit"><input type="number" min="0" step="0.01" value={materialCalculator.pricePerKg || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, pricePerKg: Number(e.target.value) }))}/><em>₹/kg</em></div>
                        </label>
                        <label>
                          <span>Material Allowance</span>
                          <div className="material-input-unit"><input type="number" min="0" step="0.1" value={materialCalculator.allowanceKg} onChange={(e) => {
                            const next = Number(e.target.value);
                            setMaterialCalculator((current) => ({ ...current, allowanceKg: Number.isFinite(next) ? Math.max(0, next) : 0 }));
                            setMaterialCalculatorMissing([]);
                          }}/><em>kg</em></div>
                        </label>
                      </div>

                      <div className="material-dimension-card">
                        <div className="material-section-title"><b>Dimensions</b><span>All dimensions in mm</span></div>
                        <div className="material-dimension-grid">
                          <label><span>Length</span><input type="number" min="0" step="0.01" value={materialCalculator.lengthMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, lengthMm: Number(e.target.value) }))}/></label>

                          {materialCalculator.shape === "plate" && (
                            <>
                              <label><span>Width</span><input type="number" min="0" step="0.01" value={materialCalculator.widthMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, widthMm: Number(e.target.value) }))}/></label>
                              <label><span>Thickness</span><input type="number" min="0" step="0.01" value={materialCalculator.thicknessMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, thicknessMm: Number(e.target.value) }))}/></label>
                            </>
                          )}

                          {materialCalculator.shape === "round_bar" && (
                            <label><span>Diameter</span><input type="number" min="0" step="0.01" value={materialCalculator.diameterMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, diameterMm: Number(e.target.value) }))}/></label>
                          )}

                          {materialCalculator.shape === "pipe" && (
                            <>
                              <label><span>Outer Diameter</span><input type="number" min="0" step="0.01" value={materialCalculator.outerDiameterMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, outerDiameterMm: Number(e.target.value) }))}/></label>
                              <label><span>Inner Diameter</span><input type="number" min="0" step="0.01" value={materialCalculator.innerDiameterMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, innerDiameterMm: Number(e.target.value) }))}/></label>
                            </>
                          )}

                          {materialCalculator.shape === "rect_tube" && (
                            <>
                              <label><span>Outside Width</span><input type="number" min="0" step="0.01" value={materialCalculator.widthMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, widthMm: Number(e.target.value) }))}/></label>
                              <label><span>Outside Height</span><input type="number" min="0" step="0.01" value={materialCalculator.heightMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, heightMm: Number(e.target.value) }))}/></label>
                              <label><span>Wall Thickness</span><input type="number" min="0" step="0.01" value={materialCalculator.wallThicknessMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, wallThicknessMm: Number(e.target.value) }))}/></label>
                            </>
                          )}

                          {materialCalculator.shape === "angle" && (
                            <>
                              <label><span>Leg A</span><input type="number" min="0" step="0.01" value={materialCalculator.legAMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, legAMm: Number(e.target.value) }))}/></label>
                              <label><span>Leg B</span><input type="number" min="0" step="0.01" value={materialCalculator.legBMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, legBMm: Number(e.target.value) }))}/></label>
                              <label><span>Thickness</span><input type="number" min="0" step="0.01" value={materialCalculator.thicknessMm || ""} onChange={(e) => setMaterialCalculator((current) => ({ ...current, thicknessMm: Number(e.target.value) }))}/></label>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="material-result-grid">
                        <div><span>Volume / piece</span><b>{materialCalcVolume > 0 ? `${(materialCalcVolume / 1_000_000).toFixed(3)} cm³` : "—"}</b></div>
                        <div><span>Weight / piece</span><b>{materialCalcUnitWeight > 0 ? `${materialCalcUnitWeight.toFixed(3)} kg` : "—"}</b></div>
                        <div className="material-result-primary"><span>Costing Weight (+{Math.max(0, materialCalculator.allowanceKg).toFixed(1)} kg)</span><b>{materialCalcTotalWeight > 0 ? `${materialCalcTotalWeight.toFixed(3)} kg` : "—"}</b></div>
                        <div className="material-result-cost"><span>Material Amount</span><b>{materialCalcAmount > 0 ? money(materialCalcAmount) : "—"}</b></div>
                      </div>

                      <div className="material-modal-foot">
                        <p>Drawing-derived weight is used when available. Material allowance is editable here and is added once per product. The existing quotation wastage control remains unchanged.</p>
                        <div>
                          <button type="button" className="btn secondary" onClick={() => setShowMaterialCalculator(false)}>Cancel</button>
                          <button type="button" className="btn primary" onClick={() => void applyMaterialCalculator()}>Apply Material to Cost Sheet</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {step === 4 && drawing && (
              <section className="panel">
                <div className="heading row">
                  <div>
                    <p className="eyebrow">STEP 4</p>
                    <h2>Quotation Preview</h2>
                    <p>
                      {batchItems.length > 1
                        ? "Choose whether these drawings should be quoted separately or combined into one quotation."
                        : "Customer-facing quotation preview."}
                    </p>
                  </div>

                  <div className="actions compact">
                    <button className="btn secondary" onClick={() => setStep(3)}>
                      Back to Edit
                    </button>
                    <button className="btn secondary" onClick={() => saveQuotation("Draft")}>
                      Save Draft
                    </button>
                    <button className="btn primary" onClick={generateQuotation}>
                      {batchItems.length > 1
                        ? quoteMode === "merge"
                          ? "Generate Merged PDF"
                          : "Download Separate PDFs"
                        : "Generate PDF"}
                    </button>
                  </div>
                </div>

                {premiumEstimate && (
                  <div className="premium-release-bar">
                    <div><span>COMMERCIAL RELEASE</span><b>{premiumEstimate.margin.approval_role} approval · {premiumEstimate.lead_time.working_days} working days</b><small>{premiumEstimate.margin.approval_reason}</small></div>
                    <div className="premium-release-metrics"><span>Recommended {money(premiumEstimate.margin.recommended_sell)}</span><span>Margin {premiumEstimate.margin.gross_margin_pct.toFixed(1)}%</span></div>
                    <div className="premium-release-actions">
                      <button type="button" className="mini save" onClick={() => void api.savePremiumApproval({ drawing_no: drawing.drawing_no, action: "approve", role: premiumEstimate.margin.approval_role, note: "Approved from quotation preview" }).then(() => setMsg("Quotation approval recorded."))}>Approve</button>
                      <button type="button" className="mini" onClick={() => void api.savePremiumApproval({ drawing_no: drawing.drawing_no, action: "revision", role: premiumEstimate.margin.approval_role, note: "Revision requested from quotation preview" }).then(() => setMsg("Quotation revision request recorded."))}>Revision</button>
                      <button type="button" className="mini delete" onClick={() => void api.savePremiumApproval({ drawing_no: drawing.drawing_no, action: "reject", role: premiumEstimate.margin.approval_role, note: "Rejected from quotation preview" }).then(() => setMsg("Quotation rejection recorded."))}>Reject</button>
                    </div>
                  </div>
                )}

                {batchItems.length > 1 ? (
                  <>
                    <div className="quote-mode-box">
                      <div className="quote-mode-title">
                        <span>QUOTATION TYPE</span>
                        <b>How should the {batchItems.length} drawings be quoted?</b>
                      </div>

                      <div className="quote-mode-options">
                        <button
                          type="button"
                          className={quoteMode === "separate" ? "active" : ""}
                          onClick={() => setQuoteMode("separate")}
                        >
                          <b>Separate</b>
                          <span>One quotation PDF for each drawing</span>
                        </button>

                        <button
                          type="button"
                          className={quoteMode === "merge" ? "active" : ""}
                          onClick={() => setQuoteMode("merge")}
                        >
                          <b>Merge</b>
                          <span>One quotation with one line per drawing</span>
                        </button>
                      </div>
                    </div>

                    <div className="batch-quote">
                      <div className="batch-quote-head">
                        <div>
                          <p className="eyebrow">
                            {quoteMode === "merge" ? "MERGED QUOTATION" : "SEPARATE QUOTATIONS"}
                          </p>
                          <h3>
                            {quoteMode === "merge"
                              ? `${batchItems.length} Drawing Quotation`
                              : `${batchItems.length} Individual Quotations`}
                          </h3>
                        </div>

                        <label>
                          Customer
                          <input
                            value={customer}
                            onChange={(e) => setCustomer(e.target.value)}
                          />
                        </label>
                      </div>

                      <div className="batch-quote-table-wrap">
                        <table className="batch-quote-table">
                          <thead>
                            <tr>
                              <th>Sl.</th>
                              <th>Drawing No.</th>
                              <th>Rev</th>
                              <th>Description</th>
                              <th>Thickness</th>
                              <th>Weight</th>
                              <th>Qty</th>
                              <th>Unit Price</th>
                              <th>Total</th>
                            </tr>
                          </thead>

                          <tbody>
                            {currentBatchPayload().map((item, index) => {
                              const qty = Math.max(1, Number(item.drawing.quantity || 1));
                              const total = Number(item.summary.selling_price || 0);
                              const unitPrice = total / qty;

                              return (
                                <tr
                                  key={`${item.drawing.drawing_no}-${index}`}
                                  className={
                                    item.drawing.drawing_no === drawing.drawing_no
                                      ? "current-drawing-line"
                                      : ""
                                  }
                                >
                                  <td>{index + 1}</td>
                                  <td><b>{item.drawing.drawing_no}</b></td>
                                  <td>{item.drawing.revision}</td>
                                  <td>{item.drawing.description}</td>
                                  <td>{Number(item.drawing.thickness_mm || 0) > 0 ? `${Number(item.drawing.thickness_mm).toFixed(3)} mm` : "—"}</td>
                                  <td>{Number(item.drawing.weight_kg || 0) > 0 ? `${Number(item.drawing.weight_kg).toFixed(3)} kg` : "—"}</td>
                                  <td>{qty}</td>
                                  <td>{money(unitPrice)}</td>
                                  <td><b>{money(total)}</b></td>
                                </tr>
                              );
                            })}
                          </tbody>

                          <tfoot>
                            <tr>
                              <td colSpan={8}>
                                {quoteMode === "merge" ? "Grand Total" : "Combined Reference Total"}
                              </td>
                              <td>
                                <b>
                                  {money(
                                    currentBatchPayload().reduce(
                                      (sum, item) => sum + Number(item.summary.selling_price || 0),
                                      0
                                    )
                                  )}
                                </b>
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {quoteMode === "separate" && (
                        <p className="quote-mode-note">
                          Download creates one ZIP containing one quotation PDF for each drawing.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="quote">
                    <div className="quote-head">
                      <div>
                        <p className="eyebrow">QUOTATION</p>
                        <h3>{drawing.description}</h3>
                      </div>
                      <div>
                        <small>Drawing</small>
                        <b>{drawing.drawing_no}</b>
                        <small>Rev {drawing.revision}</small>
                      </div>
                    </div>

                    <div className="quote-info">
                      <label>
                        Customer
                        <input
                          value={customer}
                          onChange={(e) => setCustomer(e.target.value)}
                        />
                      </label>
                      <div><small>Material</small><b>{drawing.material}</b></div>
                      <div><small>Thickness</small><b>{Number(drawing.thickness_mm || 0) > 0 ? `${Number(drawing.thickness_mm).toFixed(3)} mm` : "—"}</b></div>
                      <div><small>Weight</small><b>{Number(drawing.weight_kg || 0) > 0 ? `${Number(drawing.weight_kg).toFixed(3)} kg` : "—"}</b></div>
                      <div><small>Quantity</small><b>{drawing.quantity}</b></div>
                    </div>

                    <SummaryView
                      summary={summary}
                      commercialAmountOverrides={commercialAmountOverrides}
                      finalPriceOverride={finalPriceOverride}
                      onChange={updateCommercial}
                    />
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {view === "quotes" && (
          <section className="panel">
            <div className="heading">
              <p className="eyebrow">HISTORY</p>
              <h2>Quotation History</h2>
              <p>Downloaded and manually saved quotations with date/time, rename and delete controls.</p>
            </div>
            <Recent
              quotes={quotes}
              onRename={renameSavedQuote}
              onDelete={deleteSavedQuote}
            />
          </section>
        )}

        {view === "rates" && (
          <section className="panel rate-panel">
            <div className="heading row">
              <div><p className="eyebrow">ADMIN · COST CONTROL</p><h2>Rate Master</h2><p>Select material + grade or any process/labour item, edit its rate, and set its criticality.</p></div>
              <div className="rate-heading-actions">
                <button className="btn secondary" disabled={busy} onClick={() => void restoreStarterRates()}>
                  Restore Starter Defaults
                </button>
                <button className="btn primary" onClick={() => { setDraftRate(blankRate()); setCustomGrade(""); setCustomRateField(null); setCustomRateValue(""); setShowAddRate(true); }}>+ Add Rate</button>
              </div>
            </div>

            <div className="rate-stats">
              <div><span>Materials</span><b>{rates.filter(r => r.category === "MATERIAL").length}</b></div>
              <div><span>Processes</span><b>{rates.filter(r => r.category === "PROCESS").length}</b></div>
              <div><span>Labour</span><b>{rates.filter(r => r.category === "LABOUR").length}</b></div>
              <div><span>Commercial</span><b>{rates.filter(r => r.category === "COMMERCIAL").length}</b></div>
              <div><span>High Critical</span><b>{rates.filter(r => r.critical_score >= highCritical && r.active).length}</b></div>
            </div>

            <div className="rate-toolbar">
              <div className="tabs">
                {(["MATERIAL", "PROCESS", "LABOUR", "COMMERCIAL", "OTHER", "ALL"] as RateTab[]).map((tab) => (
                  <button key={tab} className={rateTab === tab ? "active" : ""} onClick={() => setRateTab(tab)}>{tab === "MATERIAL" ? "Materials" : tab === "PROCESS" ? "Processes" : tab === "LABOUR" ? "Labour" : tab === "COMMERCIAL" ? "Commercial" : tab === "OTHER" ? "Other" : "All"}</button>
                ))}
              </div>
              <input className="search" placeholder="Search material, grade or process..." value={rateSearch} onChange={(e) => setRateSearch(e.target.value)}/>
            </div>

            <div className="critical-legend rate-legend">
              <span><i className="dot low"/>0–{mediumCritical - 1} Low</span><span><i className="dot medium"/>{mediumCritical}–{highCritical - 1} Medium</span><span><i className="dot high"/>{highCritical}–100 High</span>
              <b>Higher score = rate is more important/volatile and should be checked more carefully before quotation release.</b>
            </div>

            {showAddRate && (
              <div className="add-rate-card">
                <div className="add-rate-title">
                  <div>
                    <b>Add New Rate</b>
                    <span>Choose from dropdowns. Use + only when you need a new material, process, labour type or unit.</span>
                  </div>
                  <button className="icon-btn" onClick={() => setShowAddRate(false)}>×</button>
                </div>

                <div className="add-rate-grid">
                  <label>
                    Category
                    <select value={draftRate.category} onChange={(e) => {
                      const category = e.target.value as RateItem["category"];
                      setCustomRateField(null);
                      setCustomRateValue("");

                      if (category === "MATERIAL") {
                        const name = materialNames[0] || "Stainless Steel";
                        setDraftRate({
                          ...draftRate,
                          category,
                          name,
                          grade: catalog?.materials[name]?.[0] || "",
                          unit: "kg"
                        });
                      } else if (category === "PROCESS") {
                        setDraftRate({
                          ...draftRate,
                          category,
                          name: processOptions[0] || "Laser Cutting",
                          grade: "",
                          unit: "hr"
                        });
                      } else if (category === "LABOUR") {
                        setDraftRate({
                          ...draftRate,
                          category,
                          name: labourOptions[0] || "Fabricator",
                          grade: "",
                          unit: "hr"
                        });
                      } else if (category === "COMMERCIAL") {
                        setDraftRate({
                          ...draftRate,
                          category,
                          name: catalog?.commercial[0] || "Material Wastage",
                          grade: "",
                          unit: "%"
                        });
                      } else {
                        setDraftRate({
                          ...draftRate,
                          category,
                          name: otherOptions[0] || "Packing",
                          grade: "",
                          unit: "job"
                        });
                      }
                    }}>
                      <option value="MATERIAL">Material</option>
                      <option value="PROCESS">Process</option>
                      <option value="LABOUR">Labour</option>
                      <option value="COMMERCIAL">Commercial</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>

                  {draftRate.category === "MATERIAL" ? (
                    <>
                      <label>
                        Material Name
                        <div className="select-plus">
                          <select
                            value={draftRate.name}
                            onChange={(e) => {
                              const name = e.target.value;
                              setDraftRate({
                                ...draftRate,
                                name,
                                grade: catalog?.materials[name]?.[0] || "__CUSTOM__"
                              });
                            }}
                          >
                            {Array.from(new Set([draftRate.name, ...materialNames].filter(Boolean))).map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                          <button type="button" className="option-plus" title="Add material" onClick={() => startCustomRateOption("material")}>+</button>
                        </div>
                      </label>

                      <label>
                        Grade
                        <select value={draftRate.grade} onChange={(e) => setDraftRate({ ...draftRate, grade: e.target.value })}>
                          {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                          <option value="__CUSTOM__">+ New Grade</option>
                        </select>
                      </label>

                      {draftRate.grade === "__CUSTOM__" && (
                        <label>
                          New Grade
                          <input value={customGrade} onChange={(e) => setCustomGrade(e.target.value)} placeholder="e.g. EN 1.4404"/>
                        </label>
                      )}
                    </>
                  ) : draftRate.category === "PROCESS" ? (
                    <label>
                      Process
                      <div className="select-plus">
                        <select value={draftRate.name} onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value })}>
                          {Array.from(new Set([draftRate.name, ...processOptions].filter(Boolean))).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                        <button type="button" className="option-plus" title="Add process" onClick={() => startCustomRateOption("process")}>+</button>
                      </div>
                    </label>
                  ) : draftRate.category === "LABOUR" ? (
                    <label>
                      Labour Type
                      <div className="select-plus">
                        <select value={draftRate.name} onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value })}>
                          {Array.from(new Set([draftRate.name, ...labourOptions].filter(Boolean))).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                        <button type="button" className="option-plus" title="Add labour type" onClick={() => startCustomRateOption("labour")}>+</button>
                      </div>
                    </label>
                  ) : draftRate.category === "COMMERCIAL" ? (
                    <label>
                      Commercial Cost
                      <select
                        value={draftRate.name}
                        onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value, unit: "%" })}
                      >
                        {catalog?.commercial.map((name) => <option key={name}>{name}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Other Cost
                      <div className="select-plus">
                        <select value={draftRate.name} onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value })}>
                          {Array.from(new Set([draftRate.name, ...otherOptions].filter(Boolean))).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                        <button type="button" className="option-plus" title="Add other cost type" onClick={() => startCustomRateOption("other")}>+</button>
                      </div>
                    </label>
                  )}

                  <label>
                    Unit
                    <div className="select-plus">
                      <select value={draftRate.unit} onChange={(e) => setDraftRate({ ...draftRate, unit: e.target.value })}>
                        {Array.from(new Set([draftRate.unit, ...unitOptions].filter(Boolean))).map((unit) => (
                          <option key={unit} value={unit}>{unit}</option>
                        ))}
                      </select>
                      <button type="button" className="option-plus" title="Add unit" onClick={() => startCustomRateOption("unit")}>+</button>
                    </div>
                  </label>

                  <label>
                    Rate / Price
                    <input type="number" min="0" step="0.01" value={draftRate.price} onChange={(e) => setDraftRate({ ...draftRate, price: +e.target.value })}/>
                  </label>

                  <label>
                    Critical Score (0–100)
                    <input type="number" min="0" max="100" value={draftRate.critical_score} onChange={(e) => setDraftRate({ ...draftRate, critical_score: Math.max(0, Math.min(100, +e.target.value)) })}/>
                  </label>

                  <label className="wide">
                    Notes
                    <input value={draftRate.notes} onChange={(e) => setDraftRate({ ...draftRate, notes: e.target.value })} placeholder="Supplier/source/validity note"/>
                  </label>
                </div>

                {customRateField && customRateField !== "material" && (
                  <div className="custom-option-row">
                    <label>
                      {customRateField === "process"
                        ? "New Process"
                        : customRateField === "labour"
                          ? "New Labour Type"
                          : customRateField === "unit"
                            ? "New Unit"
                            : "New Other Cost"}
                      <input
                        autoFocus
                        value={customRateValue}
                        onChange={(e) => setCustomRateValue(e.target.value)}
                        placeholder={
                          customRateField === "unit"
                            ? "e.g. cycle"
                            : "Enter new option"
                        }
                      />
                    </label>
                    <button type="button" className="btn secondary compact" onClick={() => { setCustomRateField(null); setCustomRateValue(""); }}>Cancel</button>
                    <button type="button" className="btn primary compact" onClick={confirmCustomRateOption}>Add Option</button>
                  </div>
                )}

                {customRateField === "material" && (
                  <div className="custom-option-row">
                    <label>
                      New Material
                      <input
                        autoFocus
                        value={customRateValue}
                        onChange={(e) => setCustomRateValue(e.target.value)}
                        placeholder="e.g. Tool Steel"
                      />
                    </label>
                    <button type="button" className="btn secondary compact" onClick={() => { setCustomRateField(null); setCustomRateValue(""); }}>Cancel</button>
                    <button type="button" className="btn primary compact" onClick={confirmCustomRateOption}>Add Option</button>
                  </div>
                )}

                <div className="rate-source-note">
                  <b>Rate Master = costing source.</b>
                  <span>After Save, linked engineering cost rows automatically receive this unit, rate and amount.</span>
                </div>

                <div className="actions">
                  <button className="btn secondary" onClick={() => setShowAddRate(false)}>Cancel</button>
                  <button className="btn primary" onClick={addRate}>Add to Rate Master</button>
                </div>
              </div>
            )}

            <div className="rate-table-wrap">
              <table className="rate-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Material / Process / Labour</th>
                    <th>Grade</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Critical Score</th>
                    <th>Active</th>
                    <th>Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRates.map((rate) => {
                    const rowNameOptions =
                      rate.category === "MATERIAL"
                        ? Array.from(new Set([rate.name, ...materialNames].filter(Boolean)))
                        : rate.category === "PROCESS"
                          ? Array.from(new Set([rate.name, ...processOptions].filter(Boolean)))
                          : rate.category === "LABOUR"
                            ? Array.from(new Set([rate.name, ...labourOptions].filter(Boolean)))
                            : rate.category === "COMMERCIAL"
                              ? Array.from(new Set([rate.name, ...(catalog?.commercial || [])].filter(Boolean)))
                              : Array.from(new Set([rate.name, ...otherOptions].filter(Boolean)));

                    const rowGradeOptions =
                      rate.category === "MATERIAL"
                        ? Array.from(new Set([
                            rate.grade,
                            ...(catalog?.materials[rate.name] || [])
                          ].filter(Boolean)))
                        : [];

                    const rowUnitOptions = rateRowUnitOptions(rate);

                    return (
                      <tr key={rate.id}>
                        <td><span className={`category-pill ${rate.category.toLowerCase()}`}>{rate.category}</span></td>

                        <td>
                          <select
                            className="rate-select"
                            value={rate.name}
                            disabled={rate.category === "COMMERCIAL"}
                            title={rate.category === "COMMERCIAL" ? "Managed in Settings" : undefined}
                            onChange={(e) => {
                              const nextName = e.target.value;
                              const patch: Partial<RateItem> = { name: nextName };

                              if (rate.category === "MATERIAL") {
                                const grades = catalog?.materials[nextName] || [];
                                if (grades.length && !grades.includes(rate.grade)) {
                                  patch.grade = grades[0];
                                }
                              }

                              updateRateLocal(rate.id, patch);
                            }}
                          >
                            {rowNameOptions.map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        </td>

                        <td>
                          {rate.category === "MATERIAL" ? (
                            <select
                              className="rate-select"
                              value={rate.grade}
                              onChange={(e) => updateRateLocal(rate.id, { grade: e.target.value })}
                            >
                              {rowGradeOptions.map((grade) => (
                                <option key={grade} value={grade}>{grade}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="rate-na">—</span>
                          )}
                        </td>

                        <td>
                          <select
                            className="rate-select unit-select"
                            value={rate.unit}
                            disabled={rate.category === "COMMERCIAL"}
                            title={rate.category === "COMMERCIAL" ? "Managed in Settings" : undefined}
                            onChange={(e) => updateRateLocal(rate.id, { unit: e.target.value })}
                          >
                            {rowUnitOptions.map((unit) => (
                              <option key={unit} value={unit}>{unit}</option>
                            ))}
                          </select>
                        </td>

                        <td>
                          <input
                            className="price-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={rate.price}
                            disabled={rate.category === "COMMERCIAL"}
                            title={rate.category === "COMMERCIAL" ? "Commercial percentages are edited only in Settings" : undefined}
                            onChange={(e) => updateRateLocal(rate.id, { price: +e.target.value })}
                          />
                        </td>

                        <td>
                          <div className="score-edit">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={rate.critical_score}
                              onChange={(e) => updateRateLocal(rate.id, {
                                critical_score: Math.max(0, Math.min(100, +e.target.value))
                              })}
                            />
                            <span className={`score-badge ${criticalName(rate.critical_score).toLowerCase()}`}>
                              {criticalName(rate.critical_score)}
                            </span>
                          </div>
                        </td>

                        <td>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={rate.active}
                              onChange={(e) => updateRateLocal(rate.id, { active: e.target.checked })}
                            />
                            <span/>
                          </label>
                        </td>

                        <td>
                          <input value={rate.notes} onChange={(e) => updateRateLocal(rate.id, { notes: e.target.value })}/>
                        </td>

                        <td>
                          <div className="row-actions">
                            {rate.category === "COMMERCIAL" ? (
                              <button
                                className="mini save"
                                onClick={() => setView("settings")}
                                title="Commercial percentages are managed only in Settings"
                              >
                                Settings
                              </button>
                            ) : (
                              <button className="mini save" onClick={() => saveRateRow(rate)}>Save</button>
                            )}
                            <button className="mini delete" onClick={() => removeRate(rate.id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredRates.length && (
                    <tr><td colSpan={9} className="empty-cell">No matching rates.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="rate-footnote">Starter prices are placeholders for configuration. Replace them with your approved company/supplier rates before using quotations commercially.</p>
          </section>
        )}

        {view === "dfm" && (
          <section className="artifact-page">
            <div className="panel artifact-header-panel">
              <div className="heading row">
                <div>
                  <p className="eyebrow">DESIGN FOR MANUFACTURING</p>
                  <h2>DFM Report</h2>
                  <p>Generated in the background for every analyzed drawing. Fully editable before PDF download.</p>
                </div>
                <div className="artifact-header-actions">
                  <div className="artifact-live-state">
                    <i className={dfmProcessingCount ? "processing" : selectedDfm?.status === "ATTENTION" ? "attention" : selectedDfm?.status === "REVIEW" ? "review" : "ready"}/>
                    <b>{dfmProcessingCount ? `${dfmProcessingCount} processing` : "DFM ready"}</b>
                  </div>
                  <button className="artifact-history-button" onClick={() => setShowDfmHistory(true)}>
                    <span>History</span>
                    <b>{dfmReports.length}</b>
                  </button>
                </div>
              </div>

              <div className="artifact-source-switcher">
                <div className="artifact-source-switcher-head">
                  <span>DFM</span>
                  <b>{allSourceFiles.length}</b>
                </div>

                <div className="artifact-source-switcher-list">
                  {allSourceFiles.map((selected, index) => {
                    const sourceKey = fileKey(selected);
                    const workspace = batchItems.find(
                      (item) => fileKey(item.file) === sourceKey
                    );
                    const report = workspace
                      ? dfmReports.find(
                          (item) => item.file_hash === workspace.analysis.file_hash
                        )
                      : null;
                    const extension =
                      selected.name.split(".").pop()?.toUpperCase() || "FILE";
                    const artifactIntel =
                      workspace?.analysis.engineering_intelligence
                      || workspace?.analysis.ai_raw?.engineering_intelligence;
                    const artifactClass = artifactIntel?.document_type
                      ? artifactIntel.document_type.replace(" Drawing", "")
                      : extension;

                    return (
                      <button
                        type="button"
                        key={`dfm-${sourceKey}`}
                        className={
                          report && selectedDfm?.id === report.id ? "active" : ""
                        }
                        disabled={!report}
                        onClick={() => {
                          if (!report || !workspace) return;
                          setSelectedDfmId(report.id);
                          setActiveSourceKey(sourceKey);
                          setActiveBatchId(workspace.id);
                        }}
                      >
                        <small>{index + 1}/{allSourceFiles.length}</small>
                        <b>
                          {workspace?.drawing.drawing_no
                            || selected.name.replace(/\.[^.]+$/, "")}
                        </b>
                        <span>
                          {report
                            ? `${artifactClass} · ${report.status}`
                            : `${artifactClass} · Processing`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="artifact-editor artifact-editor-full">
                  {selectedDfm ? (
                    <>
                      <div className="artifact-toolbar">
                        <input value={selectedDfm.name} onChange={(e) => updateDfm({ ...selectedDfm, name: e.target.value })}/>
                        <button className="btn secondary" onClick={() => renameDfm(selectedDfm)}>Rename</button>
                        <button className="btn secondary" onClick={() => void api.exportDfm(selectedDfm)}>Download PDF</button>
                        <button className="btn danger" onClick={() => deleteDfm(selectedDfm)}>Delete</button>
                      </div>

                      <div className="artifact-kpi-grid dfm-kpis">
                        <div className={selectedDfm.drawing_no ? "" : "needs-attention"}>
                          <span>Drawing</span>
                          <b>{selectedDfm.drawing_no || "Unknown"}</b>
                          <small>{selectedDfm.filename || "Source drawing"}</small>
                        </div>

                        <label className={selectedDfm.classification.includes("review") ? "needs-attention" : ""}>
                          <span>Manufacturing Type</span>
                          <select value={selectedDfm.classification} onChange={(e) => updateDfm({ ...selectedDfm, classification: e.target.value })}>
                            <option>Fabrication</option>
                            <option>Machining</option>
                            <option>Fabrication + Machining</option>
                            <option>Manufacturing route requires engineer review</option>
                          </select>
                          <small>Auto-classified from process/features</small>
                        </label>

                        <label className={selectedDfm.status === "READY" ? "kpi-good" : "needs-attention"}>
                          <span>DFM Status</span>
                          <select value={selectedDfm.status} onChange={(e) => updateDfm({ ...selectedDfm, status: e.target.value })}>
                            <option>READY</option>
                            <option>REVIEW</option>
                            <option>ATTENTION</option>
                          </select>
                          <small>{selectedDfm.status === "READY" ? "No blocking flag" : "Engineer attention required"}</small>
                        </label>

                        <div className="kpi-good">
                          <span>Passed Checks</span>
                          <b>{selectedDfmPassCount}</b>
                          <small>Manufacturing checks passed</small>
                        </div>

                        <div className={selectedDfmReviewCount ? "needs-attention" : "kpi-good"}>
                          <span>Review</span>
                          <b>{selectedDfmReviewCount}</b>
                          <small>{selectedDfmReviewCount ? "Needs engineer review" : "No review flags"}</small>
                        </div>

                        <div className={selectedDfmFailCount ? "needs-attention strong" : "kpi-good"}>
                          <span>Failed / Blocking</span>
                          <b>{selectedDfmFailCount}</b>
                          <small>{selectedDfmFailCount ? "Resolve before release" : "No failed checks"}</small>
                        </div>
                      </div>

                      {selectedDfmAttentionCount > 0 && (
                        <div className="artifact-attention-banner">
                          <i/>
                          <div>
                            <b>{selectedDfmAttentionCount} DFM item{selectedDfmAttentionCount === 1 ? "" : "s"} need attention</b>
                            <span>Red-highlighted rows contain unknown, review or failed manufacturing conditions.</span>
                          </div>
                        </div>
                      )}

                      <div className={`dfm-reference-layout ${selectedDfmHas3D ? "with-cad" : "without-cad"}`}>
                        {selectedDfmHas3D && selectedDfmSourceFile && (
                          <div className="dfm-cad-review-card">
                            <div className="artifact-subhead">
                              <div>
                                <b>3D Model Review</b>
                                <span>
                                  {selectedDfmSourceFile.name}
                                </span>
                              </div>
                            </div>

                            <div className="dfm-cad-square">
                              <ModelViewer
                                file={selectedDfmSourceFile}
                                issueCount={selectedDfm.checks.filter(
                                  (item) => item.result !== "PASS"
                                ).length}
                              />
                            </div>
                          </div>
                        )}

                        <div className="dfm-reference-card">
                          <div className="artifact-subhead">
                            <div>
                              <b>International DFM Reference Matrix</b>
                              <span>
                                Applicable engineering references
                              </span>
                            </div>
                          </div>

                          <div className="artifact-table-wrap">
                            <table className="artifact-table reference-table">
                              <thead>
                                <tr>
                                  <th>International Reference</th>
                                  <th>DFM Check Basis / Scope</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedDfm.standards.map((item, index) => (
                                  <tr key={`${item.standard}-${index}`}>
                                    <td>
                                      <input
                                        value={item.standard}
                                        onChange={(e) => {
                                          const standards = [...selectedDfm.standards];
                                          standards[index] = {
                                            ...standards[index],
                                            standard: e.target.value
                                          };
                                          updateDfm({ ...selectedDfm, standards });
                                        }}
                                      />
                                    </td>
                                    <td>
                                      <textarea
                                        value={item.scope}
                                        onChange={(e) => {
                                          const standards = [...selectedDfm.standards];
                                          standards[index] = {
                                            ...standards[index],
                                            scope: e.target.value
                                          };
                                          updateDfm({ ...selectedDfm, standards });
                                        }}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      <div className="artifact-section">
                        <div className="artifact-subhead"><div><b>Manufacturing Feasibility</b><span>PASS / REVIEW / FAIL with recommendations</span></div></div>
                        <div className="artifact-table-wrap">
                          <table className="artifact-table dfm-check-table">
                            <thead><tr><th>Area</th><th>Result</th><th>Finding</th><th>Recommendation</th><th>Reference</th></tr></thead>
                            <tbody>
                              {selectedDfm.checks.map((item, index) => (
                                <tr
                                  key={`${item.area}-${index}`}
                                  className={
                                    item.result === "FAIL"
                                      ? "artifact-row-fail"
                                      : item.result === "REVIEW"
                                        ? "artifact-row-review"
                                        : ""
                                  }
                                >
                                  <td><input value={item.area} onChange={(e) => {
                                    const checks = [...selectedDfm.checks]; checks[index] = { ...checks[index], area: e.target.value }; updateDfm({ ...selectedDfm, checks });
                                  }}/></td>
                                  <td><select value={item.result} onChange={(e) => {
                                    const checks = [...selectedDfm.checks]; checks[index] = { ...checks[index], result: e.target.value }; updateDfm({ ...selectedDfm, checks });
                                  }}><option>PASS</option><option>REVIEW</option><option>FAIL</option></select></td>
                                  <td><textarea value={item.finding} onChange={(e) => {
                                    const checks = [...selectedDfm.checks]; checks[index] = { ...checks[index], finding: e.target.value }; updateDfm({ ...selectedDfm, checks });
                                  }}/></td>
                                  <td><textarea value={item.recommendation} onChange={(e) => {
                                    const checks = [...selectedDfm.checks]; checks[index] = { ...checks[index], recommendation: e.target.value }; updateDfm({ ...selectedDfm, checks });
                                  }}/></td>
                                  <td><input value={item.standard} onChange={(e) => {
                                    const checks = [...selectedDfm.checks]; checks[index] = { ...checks[index], standard: e.target.value }; updateDfm({ ...selectedDfm, checks });
                                  }}/></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="artifact-section">
                        <div className="artifact-subhead"><div><b>Manufacturing Process Plan</b><span>Editable process / tooling / feasibility / inspection</span></div></div>
                        <div className="artifact-table-wrap">
                          <table className="artifact-table">
                            <thead><tr><th>Seq</th><th>Process</th><th>Tooling / Method</th><th>Feasibility</th><th>Inspection</th></tr></thead>
                            <tbody>
                              {selectedDfm.process_plan.map((item, index) => (
                                <tr key={`${item.sequence}-${index}`}>
                                  <td><input type="number" value={item.sequence} onChange={(e) => {
                                    const process_plan = [...selectedDfm.process_plan]; process_plan[index] = { ...process_plan[index], sequence: +e.target.value }; updateDfm({ ...selectedDfm, process_plan });
                                  }}/></td>
                                  <td><input value={item.process} onChange={(e) => {
                                    const process_plan = [...selectedDfm.process_plan]; process_plan[index] = { ...process_plan[index], process: e.target.value }; updateDfm({ ...selectedDfm, process_plan });
                                  }}/></td>
                                  <td><textarea value={item.tooling} onChange={(e) => {
                                    const process_plan = [...selectedDfm.process_plan]; process_plan[index] = { ...process_plan[index], tooling: e.target.value }; updateDfm({ ...selectedDfm, process_plan });
                                  }}/></td>
                                  <td><input value={item.feasibility} onChange={(e) => {
                                    const process_plan = [...selectedDfm.process_plan]; process_plan[index] = { ...process_plan[index], feasibility: e.target.value }; updateDfm({ ...selectedDfm, process_plan });
                                  }}/></td>
                                  <td><textarea value={item.inspection} onChange={(e) => {
                                    const process_plan = [...selectedDfm.process_plan]; process_plan[index] = { ...process_plan[index], inspection: e.target.value }; updateDfm({ ...selectedDfm, process_plan });
                                  }}/></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : <div className="artifact-empty large">No DFM report yet. Analyze one or more drawings.</div>}
              </div>

              {showDfmHistory && (
                <div className="artifact-history-modal-backdrop" onMouseDown={() => setShowDfmHistory(false)}>
                  <div className="artifact-history-modal" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="artifact-history-modal-head">
                      <div>
                        <p className="eyebrow">DFM REPORTS</p>
                        <h3>DFM History</h3>
                        <span>{dfmReports.length} saved report{dfmReports.length === 1 ? "" : "s"}</span>
                      </div>
                      <button className="icon-btn" onClick={() => setShowDfmHistory(false)}>×</button>
                    </div>

                    <div className="artifact-history-list-full">
                      {dfmReports.slice().reverse().map((report) => (
                        <div
                          key={report.id}
                          className={selectedDfm?.id === report.id ? "active" : ""}
                        >
                          <button
                            className="artifact-history-select"
                            onClick={() => {
                              setSelectedDfmId(report.id);
                              setShowDfmHistory(false);
                            }}
                          >
                            <i className={`artifact-dot ${report.status === "READY" ? "ready" : report.status === "ATTENTION" ? "attention" : "review"}`}/>
                            <span>
                              <b>{report.name}</b>
                              <small>{report.drawing_no || report.filename} · Rev {report.revision || "—"}</small>
                            </span>
                            <em>{new Date(report.created_at).toLocaleString()}</em>
                          </button>
                          <div className="artifact-history-row-actions">
                            <button className="mini save" onClick={() => renameDfm(report)}>Rename</button>
                            <button className="mini delete" onClick={() => deleteDfm(report)}>Delete</button>
                          </div>
                        </div>
                      ))}

                      {!dfmReports.length && (
                        <div className="artifact-empty large">
                          No DFM history yet. Analyze a drawing to create the first report.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {view === "bom" && (
          <section className="artifact-page">
            <div className="panel artifact-header-panel">
              <div className="heading row">
                <div>
                  <p className="eyebrow">BILL OF MATERIALS</p>
                  <h2>BOM</h2>
                  <p>Generated in parallel from drawing data and current costing. Fully editable before Word download.</p>
                </div>
                <div className="artifact-header-actions">
                  <div className="artifact-live-state">
                    <i className={bomProcessingCount ? "processing" : "ready"}/>
                    <b>{bomProcessingCount ? `${bomProcessingCount} processing` : "BOM ready"}</b>
                  </div>
                  <button className="artifact-history-button" onClick={() => setShowBomHistory(true)}>
                    <span>History</span>
                    <b>{bomReports.length}</b>
                  </button>
                </div>
              </div>

              <div className="artifact-source-switcher">
                <div className="artifact-source-switcher-head">
                  <span>BOM</span>
                  <b>{allSourceFiles.length}</b>
                </div>

                <div className="artifact-source-switcher-list">
                  {allSourceFiles.map((selected, index) => {
                    const sourceKey = fileKey(selected);
                    const workspace = batchItems.find(
                      (item) => fileKey(item.file) === sourceKey
                    );
                    const report = workspace
                      ? bomReports.find(
                          (item) => item.file_hash === workspace.analysis.file_hash
                        )
                      : null;
                    const extension =
                      selected.name.split(".").pop()?.toUpperCase() || "FILE";
                    const artifactIntel =
                      workspace?.analysis.engineering_intelligence
                      || workspace?.analysis.ai_raw?.engineering_intelligence;
                    const artifactClass = artifactIntel?.document_type
                      ? artifactIntel.document_type.replace(" Drawing", "")
                      : extension;

                    return (
                      <button
                        type="button"
                        key={`bom-${sourceKey}`}
                        className={
                          report && selectedBom?.id === report.id ? "active" : ""
                        }
                        disabled={!report}
                        onClick={() => {
                          if (!report || !workspace) return;
                          setSelectedBomId(report.id);
                          setActiveSourceKey(sourceKey);
                          setActiveBatchId(workspace.id);
                        }}
                      >
                        <small>{index + 1}/{allSourceFiles.length}</small>
                        <b>
                          {workspace?.drawing.drawing_no
                            || selected.name.replace(/\.[^.]+$/, "")}
                        </b>
                        <span>
                          {report ? `${artifactClass} · Ready` : `${artifactClass} · Processing`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="artifact-editor artifact-editor-full">
                  {selectedBom ? (
                    <>
                      <div className="artifact-toolbar">
                        <input value={selectedBom.name} onChange={(e) => updateBom({ ...selectedBom, name: e.target.value })}/>
                        <button className="btn secondary" onClick={() => renameBom(selectedBom)}>Rename</button>
                        <button className="btn secondary" onClick={() => void api.exportBomPdf(selectedBom)}>Download PDF</button>
                        <button className="btn danger" onClick={() => deleteBom(selectedBom)}>Delete</button>
                      </div>

                      <div className="artifact-kpi-grid bom-kpis">
                        <div className={selectedBom.drawing_no ? "" : "needs-attention"}>
                          <span>Drawing</span>
                          <b>{selectedBom.drawing_no || "Unknown"}</b>
                          <small>Revision {selectedBom.revision || "—"}</small>
                        </div>

                        <div>
                          <span>Total Items</span>
                          <b>{selectedBom.items.length}</b>
                          <small>All BOM lines</small>
                        </div>

                        <div>
                          <span>Material Lines</span>
                          <b>{selectedBomMaterialCount}</b>
                          <small>Raw / manufactured material</small>
                        </div>

                        <div>
                          <span>Standard / Purchased</span>
                          <b>{selectedBomStandardCount}</b>
                          <small>Bolt, nut, stud, purchased parts</small>
                        </div>

                        <div className={selectedBomMissingCount ? "needs-attention strong" : "kpi-good"}>
                          <span>Missing / Review</span>
                          <b>{selectedBomMissingCount}</b>
                          <small>{selectedBomMissingCount ? "Complete red-marked rows" : "Required fields complete"}</small>
                        </div>

                        <div className="kpi-money">
                          <span>Total BOM Cost</span>
                          <b>{money(selectedBomTotalCost)}</b>
                          <small>Editable item-cost total</small>
                        </div>
                      </div>

                      {selectedBomMissingCount > 0 && (
                        <div className="artifact-attention-banner">
                          <i/>
                          <div>
                            <b>{selectedBomMissingCount} BOM row{selectedBomMissingCount === 1 ? "" : "s"} need review</b>
                            <span>Missing description, material, quantity or unit is highlighted in red.</span>
                          </div>
                        </div>
                      )}

                      <div className="artifact-section">
                        <div className="artifact-subhead">
                          <div><b>Editable BOM Table</b><span>Raw material + detected standard/purchased parts</span></div>
                          <button className="btn secondary" onClick={() => updateBom({
                            ...selectedBom,
                            items: [...selectedBom.items, {
                              item_no: selectedBom.items.length + 1,
                              category: "Standard Part",
                              description: "",
                              material: "",
                              specification: "",
                              dimensions: "",
                              quantity: 1,
                              unit: "each",
                              weight_kg: 0,
                              unit_cost: 0,
                              total_cost: 0,
                              source: "Manual",
                              remarks: ""
                            }]
                          })}>+ Add BOM Item</button>
                        </div>

                        <div className="artifact-table-wrap">
                          <table className="artifact-table bom-table">
                            <thead>
                              <tr><th>Item</th><th>Category</th><th>Description</th><th>Material</th><th>Specification</th><th>Dimensions / Size</th><th>Qty</th><th>Unit</th><th>Weight kg</th><th>Unit Cost</th><th>Total</th><th>Remarks</th><th/></tr>
                            </thead>
                            <tbody>
                              {selectedBom.items.map((item, index) => (
                                <tr
                                  key={`${item.item_no}-${index}`}
                                  className={
                                    !String(item.description || "").trim()
                                    || !String(item.unit || "").trim()
                                    || Number(item.quantity || 0) <= 0
                                    || (item.category === "Raw Material" && !String(item.material || "").trim())
                                      ? "artifact-row-fail"
                                      : ""
                                  }
                                >
                                  <td><input type="number" value={item.item_no} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], item_no: +e.target.value }; updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><select value={item.category} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], category: e.target.value }; updateBom({ ...selectedBom, items });
                                  }}><option>Raw Material</option><option>Standard Part</option><option>Manufactured Part</option><option>Purchased Part</option></select></td>
                                  <td><input value={item.description} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], description: e.target.value }; updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><input value={item.material} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], material: e.target.value }; updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><input value={item.specification} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], specification: e.target.value }; updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><input value={item.dimensions} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], dimensions: e.target.value }; updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><input type="number" value={item.quantity} onChange={(e) => {
                                    const items = [...selectedBom.items];
                                    const quantity = +e.target.value || 0;
                                    items[index] = { ...items[index], quantity, total_cost: quantity * Number(items[index].unit_cost || 0) };
                                    updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><select value={item.unit} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], unit: e.target.value }; updateBom({ ...selectedBom, items });
                                  }}><option>each</option><option>kg</option><option>g</option><option>m</option><option>mm</option><option>set</option></select></td>
                                  <td><input type="number" value={item.weight_kg} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], weight_kg: +e.target.value || 0 }; updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><input type="number" value={item.unit_cost} onChange={(e) => {
                                    const items = [...selectedBom.items];
                                    const unit_cost = +e.target.value || 0;
                                    items[index] = { ...items[index], unit_cost, total_cost: Number(items[index].quantity || 0) * unit_cost };
                                    updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><b>{money(item.total_cost)}</b></td>
                                  <td><input value={item.remarks} onChange={(e) => {
                                    const items = [...selectedBom.items]; items[index] = { ...items[index], remarks: e.target.value }; updateBom({ ...selectedBom, items });
                                  }}/></td>
                                  <td><button className="mini delete" onClick={() => updateBom({ ...selectedBom, items: selectedBom.items.filter((_, itemIndex) => itemIndex !== index) })}>Delete</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : <div className="artifact-empty large">No BOM yet. Analyze one or more drawings.</div>}
              </div>

              {showBomHistory && (
                <div className="artifact-history-modal-backdrop" onMouseDown={() => setShowBomHistory(false)}>
                  <div className="artifact-history-modal" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="artifact-history-modal-head">
                      <div>
                        <p className="eyebrow">BILL OF MATERIALS</p>
                        <h3>BOM History</h3>
                        <span>{bomReports.length} saved BOM{bomReports.length === 1 ? "" : "s"}</span>
                      </div>
                      <button className="icon-btn" onClick={() => setShowBomHistory(false)}>×</button>
                    </div>

                    <div className="artifact-history-list-full">
                      {bomReports.slice().reverse().map((report) => (
                        <div
                          key={report.id}
                          className={selectedBom?.id === report.id ? "active" : ""}
                        >
                          <button
                            className="artifact-history-select"
                            onClick={() => {
                              setSelectedBomId(report.id);
                              setShowBomHistory(false);
                            }}
                          >
                            <i className="artifact-dot ready"/>
                            <span>
                              <b>{report.name}</b>
                              <small>{report.drawing_no || report.filename} · Rev {report.revision || "—"}</small>
                            </span>
                            <em>{new Date(report.created_at).toLocaleString()}</em>
                          </button>
                          <div className="artifact-history-row-actions">
                            <button className="mini save" onClick={() => renameBom(report)}>Rename</button>
                            <button className="mini delete" onClick={() => deleteBom(report)}>Delete</button>
                          </div>
                        </div>
                      ))}

                      {!bomReports.length && (
                        <div className="artifact-empty large">
                          No BOM history yet. Analyze a drawing to create the first BOM.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {view === "dataset" && (
          <section className="panel">
            <div className="heading row">
              <div>
                <p className="eyebrow">CURATED LEARNING</p>
                <h2>Training Dataset</h2>
                <p>Only drawings explicitly approved with “Send to Training” after quotation download are stored as training samples.</p>
              </div>
              <button className="btn secondary" onClick={() => api.exportDataset()}>Export Training Dataset ZIP</button>
            </div>
            <div className="cards four">
              <article><small>Workspace Datasets</small><b>{workspaceDatasets.length}</b><span>Auto-saved quotation folders</span></article>
              <article><small>Extractions</small><b>{stats?.extractions ?? 0}</b><span>Processing history</span></article>
              <article><small>Training Samples</small><b>{stats?.training_samples ?? 0}</b><span>Approved drawings only</span></article>
              <article><small>Dataset Version</small><b>v{stats?.dataset_version ?? 1}</b><span>Curated training set</span></article>
            </div>

            <div className="workspace-dataset-panel">
              <div className="heading row workspace-dataset-heading">
                <div>
                  <p className="eyebrow">AUTO-SAVED WORK</p>
                  <h3>Workspace Dataset Folders</h3>
                  <p>Every drawing, reviewed sheet, costing state, DFM, BOM and linked 3D model is stored with the active workspace dataset in this browser.</p>
                </div>
                <button className="btn secondary" onClick={() => void refreshWorkspaceDatasets()}>Refresh Folders</button>
              </div>

              <div className="workspace-dataset-list">
                {workspaceDatasets.map((item) => (
                  <article key={item.datasetId}>
                    <div className="workspace-dataset-icon">DATA</div>
                    <div className="workspace-dataset-main">
                      <b>{item.datasetName}</b>
                      <span>
                        {item.drawingNo || "Drawing not yet identified"} · Step {item.step} · {item.fileCount} file{item.fileCount === 1 ? "" : "s"}
                      </span>
                      <small>
                        Last saved {item.savedAt ? new Date(item.savedAt).toLocaleString() : "—"}
                        {item.hasDfm ? " · DFM" : ""}
                        {item.hasBom ? " · BOM" : ""}
                      </small>
                    </div>
                    <div className="workspace-dataset-actions">
                      <button className="mini save" onClick={() => void restoreWorkspaceDataset(item.datasetId)}>Open</button>
                      <button className="mini delete" onClick={() => void removeWorkspaceDataset(item.datasetId)}>Delete</button>
                    </div>
                  </article>
                ))}

                {!workspaceDatasets.length && (
                  <div className="empty">
                    No workspace dataset folder yet. Upload a drawing and the first folder will be created automatically.
                  </div>
                )}
              </div>
            </div>
            <div className="notice">
              <b>{stats?.batch_ready ? "Training batch is ready." : "Collecting approved training samples."}</b>
              <span>Approved since current version: {stats?.new_training_since_version ?? 0} / {stats?.training_batch_threshold ?? 25}</span>
              <span>Workspace Dataset Folders auto-save active work. Curated Training Samples are still added only when you explicitly choose “Send to Training”.</span>
            </div>
          </section>
        )}

        {view === "settings" && settings && (
          <SettingsEditor
            value={settings}
            setValue={setSettings}
            save={() => void saveAppSettings()}
          />
        )}
      </section>

      {trainingPromptItems.length > 0 && (
        <div className="training-modal-backdrop" role="presentation">
          <div className="training-modal" role="dialog" aria-modal="true" aria-labelledby="training-modal-title">
            <div className="training-modal-icon">AI</div>
            <div>
              <p className="eyebrow">QUOTATION DOWNLOADED</p>
              <h3 id="training-modal-title">Send to Training?</h3>
              <p>
                Add {trainingPromptItems.length === 1
                  ? "this drawing"
                  : `${trainingPromptItems.length} drawings`} to the curated Training Dataset.
              </p>
              <div className="training-includes">
                <span>✓ Original drawing file</span>
                <span>✓ AI extracted features</span>
                <span>✓ Your final reviewed values</span>
                <span>✓ Final costing & quotation summary</span>
              </div>
            </div>
            <div className="training-modal-actions">
              <button
                className="btn secondary"
                disabled={trainingBusy}
                onClick={() => setTrainingPromptItems([])}
              >
                Not Now
              </button>
              <button
                className="btn primary"
                disabled={trainingBusy}
                onClick={() => void sendCurrentQuotationToTraining()}
              >
                {trainingBusy ? "Sending…" : "Send to Training"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}


type EditableColumn = {
  key: string;
  label: string;
  kind?: "text" | "number" | "boolean";
  placeholder?: string;
};

function emptyFeatureRow(columns: EditableColumn[]) {
  const row: Record<string, unknown> = { confidence: 70 };
  columns.forEach((column) => {
    row[column.key] = column.kind === "boolean" ? false : column.kind === "number" ? null : "";
  });
  return row;
}

function EditableFeatureTable({
  sectionKey,
  title,
  items = [],
  columns,
  onChange
}: {
  sectionKey: string;
  title: string;
  items?: Record<string, unknown>[];
  columns: EditableColumn[];
  onChange: (items: Record<string, unknown>[]) => void;
}) {
  const changeCell = (rowIndex: number, column: EditableColumn, raw: string | boolean) => {
    const next = items.map((item) => ({ ...item }));
    const current = next[rowIndex] || {};

    if (column.kind === "boolean") {
      current[column.key] = Boolean(raw);
    } else if (column.kind === "number") {
      const text = String(raw);
      current[column.key] = text.trim() === "" ? null : Number(text);
    } else {
      current[column.key] = String(raw);
    }

    // A manually edited AI row should be visually marked as reviewed rather than red.
    current.confidence = Math.max(70, Number(current.confidence || 0));
    next[rowIndex] = current;
    onChange(next);
  };

  const addRow = () => {
    onChange([...items, emptyFeatureRow(columns)]);
  };

  const removeRow = (rowIndex: number) => {
    onChange(items.filter((_, index) => index !== rowIndex));
  };

  return (
    <div className="editable-sheet-table" id={`sheet-${sectionKey}`}>
      <div className="editable-table-head">
        <div>
          <h4>{title}</h4>
          <small>{items.length} row{items.length === 1 ? "" : "s"} · click any cell to edit</small>
        </div>
        <button className="table-add-btn" type="button" onClick={addRow}>+ Add Row</button>
      </div>

      <div className="editable-table-scroll">
        <table>
          <thead>
            <tr>
              <th className="status-col">Status</th>
              {columns.map((column) => <th key={column.key}>{column.label}</th>)}
              <th className="action-col">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, rowIndex) => {
              const signal = signalFromConfidence(item.confidence);
              return (
                <tr key={rowIndex} id={`sheet-${sectionKey}-row-${rowIndex}`}>
                  <td className="status-col"><StatusDot signal={signal}/></td>

                  {columns.map((column) => {
                    const value = item[column.key];

                    if (column.kind === "boolean") {
                      return (
                        <td key={column.key}>
                          <label className="table-check">
                            <input
                              type="checkbox"
                              checked={Boolean(value)}
                              onChange={(event) => changeCell(rowIndex, column, event.target.checked)}
                            />
                            <span>{Boolean(value) ? "Yes" : "No"}</span>
                          </label>
                        </td>
                      );
                    }

                    return (
                      <td key={column.key}>
                        <input
                          className="sheet-cell-input"
                          type={column.kind === "number" ? "number" : "text"}
                          step={column.kind === "number" ? "any" : undefined}
                          value={value == null ? "" : String(value)}
                          placeholder={column.placeholder || "—"}
                          onChange={(event) => changeCell(rowIndex, column, event.target.value)}
                        />
                      </td>
                    );
                  })}

                  <td className="action-col">
                    <button className="table-delete-btn" type="button" onClick={() => removeRow(rowIndex)}>Remove</button>
                  </td>
                </tr>
              );
            })}

            {!items.length && (
              <tr>
                <td colSpan={columns.length + 2} className="empty-edit-row">
                  No rows extracted. Use <b>+ Add Row</b> if this drawing contains this feature.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditableTextList({
  title,
  items,
  status,
  onChange
}: {
  title: string;
  items: string[];
  status: Signal;
  onChange: (items: string[]) => void;
}) {
  const setItem = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  return (
    <div className="editable-sheet-table text-list-table">
      <div className="editable-table-head">
        <div><h4>{title}</h4><small>{items.length} row{items.length === 1 ? "" : "s"}</small></div>
        <button className="table-add-btn" type="button" onClick={() => onChange([...items, ""])}>+ Add Row</button>
      </div>
      <div className="editable-table-scroll">
        <table>
          <thead><tr><th className="status-col">Status</th><th>Details</th><th className="action-col">Action</th></tr></thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index}>
                <td className="status-col"><StatusDot signal={status}/></td>
                <td><input className="sheet-cell-input" value={item} onChange={(event) => setItem(index, event.target.value)}/></td>
                <td className="action-col"><button className="table-delete-btn" type="button" onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove</button></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={3} className="empty-edit-row">No rows. Add one if required.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function ReviewItems({
  items,
  data,
  onChange
}: {
  items: string[];
  data: AIExtraction;
  onChange: (items: string[]) => void;
}) {
  const setItem = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  const goTo = (item: string) => {
    scrollToSheetTarget(reviewTargetId(item, data));
  };

  return (
    <div className="editable-sheet-table review-navigator">
      <div className="editable-table-head">
        <div>
          <h4>Needs Review</h4>
          <small>Click Go to jump to the related sheet row</small>
        </div>
        <button
          className="table-add-btn"
          type="button"
          onClick={() => onChange([...items, ""])}
        >
          + Add Row
        </button>
      </div>

      <div className="editable-table-scroll">
        <table>
          <thead>
            <tr>
              <th className="status-col">Status</th>
              <th>Details</th>
              <th className="review-go-col">Go</th>
              <th className="action-col">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                key={index}
                className="review-click-row"
                onClick={() => goTo(item)}
                title="Click to jump to the related sheet row"
              >
                <td className="status-col"><StatusDot signal="red"/></td>
                <td>
                  <input
                    className="sheet-cell-input"
                    value={item}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setItem(index, event.target.value)}
                  />
                </td>
                <td className="review-go-col">
                  <button
                    type="button"
                    className="review-go-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      goTo(item);
                    }}
                  >
                    Go
                  </button>
                </td>
                <td className="action-col">
                  <button
                    className="table-delete-btn"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onChange(items.filter((_, i) => i !== index));
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}

            {!items.length && (
              <tr>
                <td colSpan={4} className="empty-edit-row">
                  No review items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EngineeringDetails({
  data,
  onChange
}: {
  data: AIExtraction | null;
  onChange: (data: AIExtraction) => void;
}) {
  if (!data) {
    return (
      <div className="engineering-empty">
        <b>No engineering detail object received.</b>
        <span>Analyze the drawing again before continuing to costing.</span>
      </div>
    );
  }

  const setFeature = (key: keyof AIExtraction, value: unknown) => {
    onChange({ ...data, [key]: value } as AIExtraction);
  };

  const setMaterial = (key: "family" | "grade" | "specification", value: string) => {
    onChange({
      ...data,
      material: {
        ...(data.material || {}),
        [key]: value
      }
    });
  };

  const intelligence = data.engineering_intelligence;
  const completeness = intelligence?.completeness;
  const evidence = intelligence?.evidence || data.evidence || [];

  const setIntelligence = (key: string, value: unknown) => {
    const current = data.engineering_intelligence || {
      document_type: data.document_type || "Part Drawing",
      primary_manufacturing_type: data.primary_manufacturing_type || "",
      manufacturing_types: data.manufacturing_types || [],
      part_form: data.part_form || "Unknown",
      classification_confidence: data.classification_confidence || 0,
      process_route: data.process_route || [],
      evidence: data.evidence || [],
      completeness: {
        engineering_data: 0,
        cost_confidence: 0,
        classification_confidence: data.classification_confidence || 0,
        rate_coverage: 0,
        release_state: "REVIEW",
        review_required: []
      }
    };

    const nextIntelligence = { ...current, [key]: value };
    const next: AIExtraction = {
      ...data,
      engineering_intelligence: nextIntelligence,
      document_type: key === "document_type" ? String(value) : nextIntelligence.document_type,
      primary_manufacturing_type: key === "primary_manufacturing_type" ? String(value) : nextIntelligence.primary_manufacturing_type,
      part_form: key === "part_form" ? String(value) : nextIntelligence.part_form
    };

    if (key === "primary_manufacturing_type") {
      next.manufacturing_types = Array.from(new Set([
        String(value),
        ...(nextIntelligence.manufacturing_types || [])
      ].filter(Boolean)));
      const nextRoute = Array.from(new Set([
        String(value),
        ...(nextIntelligence.process_route || []).filter((item) => item !== String(value))
      ].filter(Boolean)));
      next.process_route = nextRoute;
      next.engineering_intelligence = {
        ...nextIntelligence,
        manufacturing_types: next.manufacturing_types,
        process_route: nextRoute
      };
    }

    onChange(next);
  };

  const setSummaryNumber = (
    key: "thickness_mm" | "weight_kg" | "product_quantity",
    value: string
  ) => {
    const nextValue = value.trim() === "" ? null : Number(value);

    onChange({
      ...data,
      [key]: key === "product_quantity"
        ? (nextValue == null ? undefined : Math.max(1, Number(nextValue)))
        : nextValue
    });
  };

  const dimensionsColumns: EditableColumn[] = [
    { key: "label", label: "Label" },
    { key: "value_mm", label: "Value (mm)", kind: "number" },
    { key: "tolerance", label: "Tolerance" },
    { key: "quantity", label: "Qty", kind: "number" }
  ];

  const holesColumns: EditableColumn[] = [
    { key: "diameter_mm", label: "Diameter (mm)", kind: "number" },
    { key: "quantity", label: "Qty", kind: "number" },
    { key: "type", label: "Type" },
    { key: "callout", label: "Callout" }
  ];

  const threadsColumns: EditableColumn[] = [
    { key: "designation", label: "Designation" },
    { key: "quantity", label: "Qty", kind: "number" },
    { key: "through", label: "Through", kind: "boolean" }
  ];

  const chamferColumns: EditableColumn[] = [
    { key: "size_mm", label: "Size (mm)", kind: "number" },
    { key: "angle_deg", label: "Angle (°)", kind: "number" },
    { key: "quantity", label: "Qty", kind: "number" }
  ];

  const bendsColumns: EditableColumn[] = [
    { key: "angle_deg", label: "Angle (°)", kind: "number" },
    { key: "quantity", label: "Qty", kind: "number" }
  ];

  const studsColumns: EditableColumn[] = [
    { key: "size", label: "Size" },
    { key: "length_mm", label: "Length (mm)", kind: "number" },
    { key: "quantity", label: "Qty", kind: "number" },
    { key: "material", label: "Material" }
  ];

  const weldsColumns: EditableColumn[] = [
    { key: "type", label: "Weld Type" },
    { key: "size_mm", label: "Size (mm)", kind: "number" },
    { key: "length_mm", label: "Length (mm)", kind: "number" },
    { key: "location", label: "Location" },
    { key: "quantity", label: "Qty", kind: "number" }
  ];

  const assemblyColumns: EditableColumn[] = [
    { key: "item_no", label: "Item" },
    { key: "part_name", label: "Part / Plate" },
    { key: "drawing_no", label: "Drawing No." },
    { key: "quantity", label: "Qty", kind: "number" },
    { key: "material", label: "Material" },
    { key: "length_mm", label: "Length (mm)", kind: "number" },
    { key: "width_mm", label: "Width (mm)", kind: "number" },
    { key: "height_mm", label: "Height (mm)", kind: "number" },
    { key: "thickness_mm", label: "Thickness (mm)", kind: "number" },
    { key: "description", label: "Description" }
  ];

  const processColumns: EditableColumn[] = [
    { key: "process", label: "Process" },
    { key: "reason", label: "Reason / Drawing Basis" }
  ];

  const finishes = (data.surface_finish || []).map((x) => String(x));
  const notes = (data.notes || []).map((x) => String(x));
  const uncertain = Array.from(new Set([
    ...(data.missing_or_uncertain || []).map((x) => String(x)),
    ...(completeness?.review_required || []).map((x) => String(x))
  ].filter(Boolean)));

  return (
    <div className="engineering-details vertical-edit-sheet">
      <section className="sheet-section engineering-intelligence-section">
        <div className="sheet-section-title">
          <div><span>01</span><div><b>Engineering Classification</b><small>Document type, manufacturing route and quotation readiness</small></div></div>
        </div>

        <div className="engineering-intelligence-grid">
          <label>
            <span>Document Type</span>
            <select
              value={intelligence?.document_type || data.document_type || "Part Drawing"}
              onChange={(e) => setIntelligence("document_type", e.target.value)}
            >
              {["Part Drawing", "Assembly Drawing", "General Arrangement", "Weldment / Fabrication Drawing", "Detail Drawing"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Primary Manufacturing</span>
            <select
              value={intelligence?.primary_manufacturing_type || data.primary_manufacturing_type || "Inspection & Handling"}
              onChange={(e) => setIntelligence("primary_manufacturing_type", e.target.value)}
            >
              {["CNC Milling", "CNC Turning", "General Machining", "Laser Cutting", "Sheet-Metal Fabrication", "Welding / Fabrication", "Drilling / Boring", "Threading / Tapping", "Grinding / Finishing", "Casting", "Forging", "Extrusion", "Tube / Pipe Fabrication", "Additive Manufacturing", "Purchased / Standard Part", "Assembly / Integration", "Inspection & Handling"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Part Form</span>
            <select
              value={intelligence?.part_form || data.part_form || "Unknown"}
              onChange={(e) => setIntelligence("part_form", e.target.value)}
            >
              {["Plate", "Sheet", "Block / Prismatic", "Shaft / Cylindrical", "Flange", "Bracket", "Frame", "Tube / Pipe", "Enclosure / Cover", "Gear", "Casting", "Assembly", "Standard Part", "Unknown"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="classification-score-card">
            <span>Classification Confidence</span>
            <b>{Number(intelligence?.classification_confidence || data.classification_confidence || 0)}%</b>
            <small>{completeness?.release_state || "REVIEW"}</small>
          </div>
        </div>

        {(intelligence?.process_route || data.process_route || []).length > 0 && (
          <div className="process-route-card">
            <span>PROCESS ROUTE</span>
            <div>
              {(intelligence?.process_route || data.process_route || []).map((process, index) => (
                <span key={`${process}-${index}`}>
                  <b>{index + 1}</b>{process}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="completeness-grid">
          {[
            ["Engineering Data", completeness?.engineering_data || 0],
            ["Cost Confidence", completeness?.cost_confidence || 0],
            ["Rate Coverage", completeness?.rate_coverage || 0]
          ].map(([label, value]) => (
            <div key={String(label)}>
              <span>{label}</span>
              <b>{Number(value)}%</b>
              <i><em style={{ width: `${Math.max(0, Math.min(100, Number(value)))}%` }}/></i>
            </div>
          ))}
        </div>
      </section>

      <section className="sheet-section">
        <div className="sheet-section-title">
          <div><span>02</span><div><b>Part Summary</b><small>Editable key engineering information</small></div></div>
        </div>

        <div className="editable-summary-table">
          <table>
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>
              <tr id="sheet-summary-drawing-type">
                <td>Drawing Type</td>
                <td>
                  <input
                    className="sheet-cell-input"
                    value={data.drawing_type || ""}
                    onChange={(e) => setFeature("drawing_type", e.target.value)}
                  />
                </td>
              </tr>
              <tr id="sheet-summary-material"><td>Material Family</td><td><input className="sheet-cell-input" value={data.material?.family || ""} onChange={(e) => setMaterial("family", e.target.value)}/></td></tr>
              <tr id="sheet-summary-grade"><td>Grade</td><td><input className="sheet-cell-input" value={data.material?.grade || ""} onChange={(e) => setMaterial("grade", e.target.value)}/></td></tr>
              <tr id="sheet-summary-specification"><td>Specification</td><td><input className="sheet-cell-input" value={data.material?.specification || ""} onChange={(e) => setMaterial("specification", e.target.value)}/></td></tr>
              <tr id="sheet-summary-thickness"><td>Thickness (mm)</td><td><input className="sheet-cell-input" type="number" step="any" value={Number(data.thickness_mm || 0) > 0 ? data.thickness_mm : ""} onChange={(e) => setSummaryNumber("thickness_mm", e.target.value)}/>{(data.notes || []).some((note) => String(note).startsWith("Predicted thickness:")) && <small className="summary-derived-note">Auto-predicted from drawing geometry</small>}{(data.notes || []).some((note) => String(note).startsWith("Default thickness:")) && <small className="summary-derived-note">Defaulted to 100 mm because drawing thickness was unavailable</small>}</td></tr>
              <tr id="sheet-summary-weight">
                <td>Weight (kg)</td>
                <td>
                  <input className="sheet-cell-input" type="number" step="any" value={data.weight_kg ?? ""} onChange={(e) => setSummaryNumber("weight_kg", e.target.value)}/>
                  {data.weight_prediction && (
                    <small className="summary-derived-note" title={data.weight_prediction.basis}>
                      Predicted {Number(data.weight_prediction.base_weight_kg || 0).toFixed(3)} kg + 1 kg allowance
                    </small>
                  )}
                </td>
              </tr>
              <tr id="sheet-summary-quantity"><td>Product Quantity</td><td><input className="sheet-cell-input" type="number" min="1" step="1" value={data.product_quantity ?? ""} onChange={(e) => setSummaryNumber("product_quantity", e.target.value)}/></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="sheet-section">
        <div className="sheet-section-title">
          <div><span>03</span><div><b>Drawing Features</b><small>Full-width editable tables arranged one-by-one</small></div></div>
        </div>

        <div className="engineering-feature-stack">
          {(data.drawing_type === "assembly"
            || data.drawing_type === "weldment"
            || (data.assembly_parts || []).length > 0) && (
            <EditableFeatureTable
              sectionKey="assembly_parts"
              title="Assembly Components / Plates"
              columns={assemblyColumns}
              items={(data.assembly_parts || []) as Record<string, unknown>[]}
              onChange={(items) => setFeature("assembly_parts", items)}
            />
          )}
          <EditableFeatureTable sectionKey="dimensions" title="Dimensions" columns={dimensionsColumns} items={(data.dimensions || []) as Record<string, unknown>[]} onChange={(items) => setFeature("dimensions", items)}/>
          <EditableFeatureTable sectionKey="holes" title="Holes / Slots" columns={holesColumns} items={(data.holes || []) as Record<string, unknown>[]} onChange={(items) => setFeature("holes", items)}/>
          <EditableFeatureTable sectionKey="threads" title="Threads" columns={threadsColumns} items={(data.threads || []) as Record<string, unknown>[]} onChange={(items) => setFeature("threads", items)}/>
          <EditableFeatureTable sectionKey="chamfers" title="Chamfers" columns={chamferColumns} items={(data.chamfers || []) as Record<string, unknown>[]} onChange={(items) => setFeature("chamfers", items)}/>
          <EditableFeatureTable sectionKey="bends" title="Bends" columns={bendsColumns} items={(data.bends || []) as Record<string, unknown>[]} onChange={(items) => setFeature("bends", items)}/>
          <EditableFeatureTable sectionKey="studs" title="Studs / Fasteners" columns={studsColumns} items={(data.studs || []) as Record<string, unknown>[]} onChange={(items) => setFeature("studs", items)}/>
          <EditableFeatureTable sectionKey="welds" title="Welds" columns={weldsColumns} items={(data.welds || []) as Record<string, unknown>[]} onChange={(items) => setFeature("welds", items)}/>
          <EditableFeatureTable sectionKey="processes" title="Manufacturing Processes" columns={processColumns} items={(data.manufacturing_processes || []) as Record<string, unknown>[]} onChange={(items) => setFeature("manufacturing_processes", items)}/>
        </div>
      </section>

      <section className="sheet-section">
        <div className="sheet-section-title">
          <div><span>04</span><div><b>Notes & Review</b><small>Editable drawing notes kept one table after another</small></div></div>
        </div>

        <div className="engineering-feature-stack notes-stack">
          <div id="sheet-surface-finish"><EditableTextList title="Surface Finish" items={finishes} status="green" onChange={(items) => setFeature("surface_finish", items)}/></div>
          <div id="sheet-notes"><EditableTextList title="Drawing Notes" items={notes} status="green" onChange={(items) => setFeature("notes", items)}/></div>
          <div id="sheet-review">
            <ReviewItems
              items={uncertain}
              data={data}
              onChange={(items) => setFeature("missing_or_uncertain", items)}
            />
          </div>
        </div>
      </section>

      {evidence.length > 0 && (
        <section className="sheet-section engineering-evidence-section">
          <div className="sheet-section-title">
            <div><span>05</span><div><b>Evidence & Provenance</b><small>Why the system classified and extracted these values</small></div></div>
          </div>
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead><tr><th>Field</th><th>Value</th><th>Drawing Basis</th><th>Page</th><th>Confidence</th></tr></thead>
              <tbody>
                {evidence.map((item, index) => (
                  <tr key={`${item.field}-${index}`}>
                    <td><b>{item.field}</b></td>
                    <td>{item.value}</td>
                    <td>{item.basis}</td>
                    <td>{item.page ? item.page : "—"}</td>
                    <td><span className={`evidence-confidence ${item.confidence >= 80 ? "good" : item.confidence >= 60 ? "review" : "attention"}`}>{item.confidence}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PremiumEstimatorPanel({
  estimate,
  busy,
  onRefresh,
  onApplyProcesses,
  actualCost,
  actualHours,
  actualNotes,
  onActualCostChange,
  onActualHoursChange,
  onActualNotesChange,
  onSaveActual,
  question,
  answer,
  onQuestionChange,
  onAsk
}: {
  estimate: PremiumEstimate | null;
  busy: boolean;
  onRefresh: () => void;
  onApplyProcesses: () => void;
  actualCost: number;
  actualHours: number;
  actualNotes: string;
  onActualCostChange: (value: number) => void;
  onActualHoursChange: (value: number) => void;
  onActualNotesChange: (value: string) => void;
  onSaveActual: () => void;
  question: string;
  answer: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
}) {
  if (!estimate) {
    return (
      <section className="premium-estimator-shell">
        <div className="premium-estimator-head">
          <div><span>PREMIUM ESTIMATOR</span><b>{busy ? "Calculating engineering intelligence…" : "Premium estimate not loaded"}</b></div>
          <button type="button" className="btn secondary" onClick={onRefresh} disabled={busy}>{busy ? "Calculating…" : "Generate Premium Estimate"}</button>
        </div>
      </section>
    );
  }

  const confidenceValues = [estimate.confidence.engineering, estimate.confidence.classification, estimate.confidence.cost, estimate.confidence.rate_coverage];
  const overallConfidence = confidenceValues.length ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length) : 0;

  return (
    <section className="premium-estimator-shell">
      <div className="premium-estimator-head">
        <div>
          <span>PREMIUM ESTIMATOR ENGINE</span>
          <b>Routing, cost intelligence, margin control & learning</b>
          <small>Uses extracted geometry + Rate Master + quotation history. No additional AI call is required for this panel.</small>
        </div>
        <div className="premium-estimator-actions">
          <button type="button" className="btn secondary" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
          <button type="button" className="btn primary" onClick={onApplyProcesses}>Apply Process Costing</button>
        </div>
      </div>

      <div className="premium-kpi-grid">
        <article><span>Confidence</span><b>{overallConfidence}%</b><small>Engineering + classification + cost + rates</small></article>
        <article><span>Recommended Sell</span><b>{money(estimate.margin.recommended_sell)}</b><small>{estimate.margin.gross_margin_pct.toFixed(1)}% estimated gross margin</small></article>
        <article><span>Lead Time</span><b>{estimate.lead_time.working_days} days</b><small>Expedite planning: {estimate.lead_time.expedite_days} days</small></article>
        <article><span>Approval</span><b>{estimate.margin.approval_role}</b><small>{estimate.margin.approval_reason}</small></article>
      </div>

      <div className="premium-two-col">
        <div className="premium-card wide-card">
          <div className="premium-card-title"><div><span>PROCESS ROUTE</span><b>Setup + run-time costing</b></div><small>{estimate.process_route.length} stages</small></div>
          <div className="premium-route">
            {estimate.process_route.map((item) => (
              <div className="premium-route-row" key={`${item.sequence}-${item.process}`}>
                <strong>{item.sequence}</strong>
                <div><b>{item.process}</b><small>{item.reason}</small></div>
                <span>{item.setup_hours.toFixed(2)}h setup</span>
                <span>{item.run_hours_per_piece.toFixed(2)}h/pc</span>
                <span>{money(item.machine_rate + item.labour_rate)}/hr</span>
                <b>{money(item.total_cost)}</b>
                <em className={item.confidence >= 85 ? "good" : "review"}>{item.confidence}%</em>
              </div>
            ))}
          </div>
        </div>

        <div className="premium-card">
          <div className="premium-card-title"><div><span>QUANTITY BREAKS</span><b>Setup amortization</b></div></div>
          <div className="premium-mini-table">
            <div className="premium-mini-head"><span>Qty</span><span>Unit</span><span>Total</span></div>
            {estimate.quantity_breaks.map((item) => <div key={item.quantity}><b>{item.quantity}</b><span>{money(item.unit_price)}</span><span>{money(item.total_price)}</span></div>)}
          </div>
        </div>
      </div>

      <div className="premium-three-col">
        <div className="premium-card">
          <div className="premium-card-title"><div><span>REQUIREMENTS</span><b>Drawing notes that affect price</b></div></div>
          {estimate.requirements.length ? estimate.requirements.map((item, index) => (
            <div className={`premium-alert ${item.severity}`} key={`${item.name}-${index}`}><b>{item.name}</b><span>{item.action}</span></div>
          )) : <p className="premium-empty">No special commercial/manufacturing requirements detected.</p>}
        </div>

        <div className="premium-card">
          <div className="premium-card-title"><div><span>DFM / RISK</span><b>Manufacturability warnings</b></div></div>
          {estimate.dfm_warnings.length ? estimate.dfm_warnings.map((item, index) => (
            <div className={`premium-alert ${item.severity}`} key={index}><b>{item.severity === "high" ? "High risk" : "Review"}</b><span>{item.message}</span></div>
          )) : <p className="premium-empty">No deterministic DFM warning detected.</p>}
        </div>

        <div className="premium-card">
          <div className="premium-card-title"><div><span>ATTENTION</span><b>Release blockers</b></div></div>
          {estimate.attention.length ? estimate.attention.slice(0, 8).map((item, index) => <div className="premium-attention" key={index}>⚠ {item}</div>) : <p className="premium-empty">No unresolved extracted requirement.</p>}
        </div>
      </div>

      <div className="premium-three-col">
        <div className="premium-card">
          <div className="premium-card-title"><div><span>SIMILAR JOBS</span><b>Reuse historical knowledge</b></div></div>
          {estimate.similar_jobs.length ? estimate.similar_jobs.map((item) => (
            <div className="premium-similar" key={item.id}><div><b>{item.drawing_no || item.description || "Saved quotation"}</b><small>{item.material} · {item.weight_kg ? `${item.weight_kg.toFixed(2)} kg` : "weight n/a"}</small></div><strong>{item.score}%</strong><span>{money(item.selling_price)}</span></div>
          )) : <p className="premium-empty">No sufficiently similar saved quotation yet.</p>}
        </div>

        <div className="premium-card">
          <div className="premium-card-title"><div><span>NESTING / SHEET</span><b>Blank utilization estimate</b></div></div>
          {estimate.nesting.available ? <>
            <div className="premium-stat-line"><span>Blank</span><b>{estimate.nesting.blank_width_mm.toFixed(1)} × {estimate.nesting.blank_height_mm.toFixed(1)} mm</b></div>
            <div className="premium-stat-line"><span>Reference sheet</span><b>{estimate.nesting.standard_sheet}</b></div>
            <div className="premium-stat-line"><span>Parts / sheet</span><b>{estimate.nesting.parts_per_sheet}</b></div>
            <div className="premium-stat-line"><span>Utilization</span><b>{estimate.nesting.utilization_pct.toFixed(1)}%</b></div>
            <div className="premium-progress"><i style={{ width: `${Math.min(100, estimate.nesting.utilization_pct)}%` }}/></div>
            <small>{estimate.nesting.scrap_pct.toFixed(1)}% estimated envelope scrap before true nesting.</small>
          </> : <p className="premium-empty">Overall blank width/height not available for nesting estimate.</p>}
        </div>

        <div className="premium-card">
          <div className="premium-card-title"><div><span>ASSEMBLY / BUYOUT</span><b>Component intelligence</b></div></div>
          <div className="premium-stat-line"><span>Assembly parts</span><b>{estimate.assembly.parts.length}</b></div>
          <div className="premium-stat-line"><span>Bought-out candidates</span><b>{estimate.assembly.bought_out.length}</b></div>
          {estimate.assembly.bought_out.slice(0, 5).map((item, index) => <div className="premium-buyout" key={index}>{String(item.part_name || item.item_no || "Standard item")} · Qty {String(item.quantity || 1)}</div>)}
        </div>
      </div>

      <div className="premium-two-col">
        <div className="premium-card">
          <div className="premium-card-title"><div><span>WHAT-IF</span><b>Commercial sensitivity</b></div></div>
          <div className="premium-whatif">
            <div><span>Material +5%</span><b>{money(estimate.what_if.material_plus_5)}</b></div>
            <div><span>Urgent delivery</span><b>{money(estimate.what_if.urgent_delivery)}</b></div>
            <div><span>Markup -3%</span><b>{money(estimate.what_if.markup_minus_3)}</b></div>
          </div>
          <div className="premium-card-title secondary-title"><div><span>COST DRIVERS</span><b>Where the quote is going</b></div></div>
          {estimate.cost_drivers.map((item) => <div className="premium-stat-line" key={item.name}><span>{item.name}</span><b>{money(item.amount)}</b></div>)}
          {estimate.savings.map((item, index) => <div className="premium-saving" key={index}>↘ {item}</div>)}
        </div>

        <div className="premium-card">
          <div className="premium-card-title"><div><span>ACTUAL vs QUOTED LEARNING</span><b>Close the estimation loop</b></div><small>{estimate.learning.samples} samples</small></div>
          <div className="premium-learning-summary">
            <div><span>Historical cost bias</span><b>{estimate.learning.cost_bias_pct > 0 ? "+" : ""}{estimate.learning.cost_bias_pct.toFixed(1)}%</b></div>
            <div><span>Historical time bias</span><b>{estimate.learning.time_bias_pct > 0 ? "+" : ""}{estimate.learning.time_bias_pct.toFixed(1)}%</b></div>
          </div>
          <div className="premium-actual-form">
            <label><span>Actual job cost</span><input type="number" min="0" value={actualCost || ""} onChange={(e) => onActualCostChange(Number(e.target.value))}/></label>
            <label><span>Actual total hours</span><input type="number" min="0" step=".1" value={actualHours || ""} onChange={(e) => onActualHoursChange(Number(e.target.value))}/></label>
            <label className="wide"><span>Learning note</span><input value={actualNotes} onChange={(e) => onActualNotesChange(e.target.value)} placeholder="What differed from the quotation?"/></label>
            <button type="button" className="btn secondary" onClick={onSaveActual} disabled={actualCost <= 0 && actualHours <= 0}>Save Actual Result</button>
          </div>
        </div>
      </div>

      <div className="premium-card estimator-assistant-card">
        <div className="premium-card-title"><div><span>ESTIMATOR ASSISTANT</span><b>Ask about cost, risk, savings, lead time or similar jobs</b></div></div>
        <div className="premium-assistant-row">
          <input value={question} onChange={(e) => onQuestionChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAsk(); }} placeholder="Example: Why is this quote expensive?"/>
          <button type="button" className="btn primary" onClick={onAsk}>Ask</button>
        </div>
        {answer && <div className="premium-assistant-answer">{answer}</div>}
      </div>
    </section>
  );
}

function SummaryView({
  summary,
  commercialAmountOverrides,
  finalPriceOverride,
  onChange
}: {
  summary: QuoteSummary;
  commercialAmountOverrides: CommercialAmountOverrides;
  finalPriceOverride: number | null;
  onChange: (
    field: "material_wastage" | "overhead" | "markup" | "selling_price",
    value: string
  ) => void;
}) {
  return (
    <div className="summary clean-summary editable-summary">
      <div>
        <span>Direct Cost</span>
        <b>{money(summary.direct_cost)}</b>
        <small>Material + Process + Labour rows</small>
      </div>

      <div>
        <span>Material Wastage</span>
        <input
          className="summary-amount-input"
          type="number"
          min="0"
          step="0.01"
          value={commercialAmountOverrides.material_wastage ?? summary.material_wastage}
          onChange={(e) => void onChange("material_wastage", e.target.value)}
        />
        <small>{Number(summary.material_wastage_pct || 0)}% from Settings · amount editable</small>
      </div>

      <div>
        <span>Overhead</span>
        <input
          className="summary-amount-input"
          type="number"
          min="0"
          step="0.01"
          value={commercialAmountOverrides.overhead ?? summary.overhead}
          onChange={(e) => void onChange("overhead", e.target.value)}
        />
        <small>{Number(summary.overhead_pct || 0)}% from Settings · amount editable</small>
      </div>

      <div className="blue">
        <span>Manufacturing Cost</span>
        <b>{money(summary.manufacturing_cost)}</b>
        <small>Calculated total</small>
      </div>

      <div>
        <span>Markup</span>
        <input
          className="summary-amount-input"
          type="number"
          min="0"
          step="0.01"
          value={commercialAmountOverrides.markup ?? summary.markup}
          onChange={(e) => void onChange("markup", e.target.value)}
        />
        <small>{Number(summary.markup_pct || 0)}% from Settings · amount editable</small>
      </div>

      <div className="green">
        <span>Final Selling Price</span>
        <input
          className="summary-final-input"
          type="number"
          min="0"
          step="0.01"
          value={finalPriceOverride ?? summary.selling_price}
          onChange={(e) => void onChange("selling_price", e.target.value)}
        />
        <small>Editable final quotation price</small>
      </div>
    </div>
  );
}



function Recent({
  quotes,
  onRename,
  onDelete
}: {
  quotes: QuoteRecord[];
  onRename: (quote: QuoteRecord) => void;
  onDelete: (quote: QuoteRecord) => void;
}) {
  return (
    <div className="quote-history-wrap">
      <div className="quote-history-table">
        <div className="qh-row qh-head">
          <span>Name</span>
          <span>Date & Time</span>
          <span>Drawing</span>
          <span>Customer</span>
          <span>Status</span>
          <span>Amount</span>
          <span>Actions</span>
        </div>

        {quotes.length ? quotes.slice().reverse().map((quote) => (
          <div className="qh-row" key={quote.id}>
            <span>
              <b>{quote.name || quote.description || quote.id}</b>
              <small>{quote.id}</small>
            </span>
            <span>{new Date(quote.created_at).toLocaleString()}</span>
            <span>
              <b>{quote.drawing_no}</b>
              <small>Rev {quote.revision || "—"}</small>
            </span>
            <span>{quote.customer}</span>
            <span><i className="history-status">{quote.status}</i></span>
            <span><b>{money(quote.selling_price)}</b></span>
            <span className="history-actions">
              <button type="button" className="mini save" onClick={() => onRename(quote)}>
                Rename
              </button>
              <button type="button" className="mini delete" onClick={() => onDelete(quote)}>
                Delete
              </button>
            </span>
          </div>
        )) : (
          <div className="empty">No saved quotations yet.</div>
        )}
      </div>
    </div>
  );
}


function RevisionList({ rows }: { rows: RevisionRecord[] }) {
  return (
    <div className="revision">
      <h3>Revision History</h3>
      {rows.length ? rows.slice().reverse().map((row) => (
        <div key={row.id}><b>{row.revision}</b><span>{row.note}</span><small>{new Date(row.created_at).toLocaleString()}</small></div>
      )) : <p>No revision snapshots yet.</p>}
    </div>
  );
}

function SettingsEditor({ value, setValue, save }: { value: Settings; setValue: (settings: Settings) => void; save: () => void }) {
  return (
    <section className="panel">
      <div className="heading row"><div><p className="eyebrow">ADMIN</p><h2>Settings</h2><p>Commercial defaults, criticality thresholds and continuous-learning controls.</p></div><button className="btn primary" onClick={save}>Save Settings</button></div>
      <div className="settings-grid">
        <label>Company Name<input value={value.company_name} onChange={(e) => setValue({ ...value, company_name: e.target.value })}/></label>
        <label>Currency<input value={value.currency} onChange={(e) => setValue({ ...value, currency: e.target.value })}/></label>
        <label>Material Wastage %<input type="number" value={value.material_wastage_pct} onChange={(e) => setValue({ ...value, material_wastage_pct: +e.target.value })}/></label>
        <label>Factory Overhead %<input type="number" value={value.overhead_pct} onChange={(e) => setValue({ ...value, overhead_pct: +e.target.value })}/></label>
        <label>Markup %<input type="number" value={value.markup_pct} onChange={(e) => setValue({ ...value, markup_pct: +e.target.value })}/></label>
        <label>Training Batch Threshold<input type="number" min="1" value={value.training_batch_threshold} onChange={(e) => setValue({ ...value, training_batch_threshold: +e.target.value })}/></label>
        <label>Medium Critical From<input type="number" min="0" max="100" value={value.critical_medium_threshold} onChange={(e) => setValue({ ...value, critical_medium_threshold: +e.target.value })}/></label>
        <label>High Critical From<input type="number" min="0" max="100" value={value.critical_high_threshold} onChange={(e) => setValue({ ...value, critical_high_threshold: +e.target.value })}/></label>
        <label className="check"><input type="checkbox" checked={value.auto_dataset_capture} onChange={(e) => setValue({ ...value, auto_dataset_capture: e.target.checked })}/> Auto Dataset Capture</label>
        <label className="check"><input type="checkbox" checked={value.learn_from_corrections} onChange={(e) => setValue({ ...value, learn_from_corrections: e.target.checked })}/> Reuse Reviewed Corrections</label>
      </div>
    </section>
  );
}
