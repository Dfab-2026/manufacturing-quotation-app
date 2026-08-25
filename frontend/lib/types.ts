export type DrawingDetails = {
  drawing_no: string;
  revision: string;
  description: string;
  material: string;
  thickness_mm: number;
  weight_kg: number;
  quantity: number;
  notes: string[];
};

export type CostRow = {
  id: string;
  category: string;
  item: string;
  drawingQty: string;
  costingQty: number;
  unit: string;
  rate: number;
  cost: number;
  confidence: "Exact" | "Estimated" | "Assumed";
  rateId?: string | null;
  rateSource: string;
  criticalScore: number;
};

export type QuoteSummary = {
  direct_cost: number;
  material_wastage: number;
  overhead: number;
  manufacturing_cost: number;
  markup: number;
  selling_price: number;
  material_wastage_pct: number;
  overhead_pct: number;
  markup_pct: number;
  material_wastage_critical: number;
  overhead_critical: number;
  markup_critical: number;
};

export type EngineeringFeature = Record<string, unknown>;

export type AssemblyPartExtraction = {
  item_no?: string;
  part_name?: string;
  drawing_no?: string;
  quantity?: number;
  material?: string;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  thickness_mm?: number | null;
  description?: string;
  confidence?: number;
};

export type AIExtraction = {
  drawing_no?: string;
  revision?: string;
  description?: string;
  drawing_type?: string;
  assembly_parts?: AssemblyPartExtraction[];
  material?: {
    family?: string;
    grade?: string;
    specification?: string;
  };
  thickness_mm?: number | null;
  weight_kg?: number | null;
  product_quantity?: number;
  dimensions?: EngineeringFeature[];
  holes?: EngineeringFeature[];
  threads?: EngineeringFeature[];
  chamfers?: EngineeringFeature[];
  bends?: EngineeringFeature[];
  studs?: EngineeringFeature[];
  welds?: EngineeringFeature[];
  surface_finish?: unknown[];
  manufacturing_processes?: EngineeringFeature[];
  notes?: unknown[];
  confidence?: Record<string, number>;
  missing_or_uncertain?: unknown[];
  cad_geometry?: {
    format?: string;
    parser_status?: string;
    root_name?: string;
    part_count?: number;
    mesh_count?: number;
    triangle_count?: number;
    dimensions_mm?: {
      x?: number;
      y?: number;
      z?: number;
    };
    surface_area_mm2?: number;
    volume_mm3?: number;
    component_names?: string[];
  };
};

export type AnalysisResponse = {
  extraction_id: string;
  file_hash: string;
  learning_source: string;
  extraction_warnings?: string[];
  text_preview?: string;
  preview_image?: string;
  drawing: DrawingDetails;
  rows: CostRow[];
  ai_raw?: AIExtraction | null;
  summary?: QuoteSummary;
  dfm?: DfmReport;
  bom?: BomReport;
  source_type?: "drawing" | "cad";
  source_format?: string;
};

export type Settings = {
  company_name: string;
  currency: string;
  material_wastage_pct: number;
  overhead_pct: number;
  markup_pct: number;
  auto_dataset_capture: boolean;
  learn_from_corrections: boolean;
  training_batch_threshold: number;
  critical_medium_threshold: number;
  critical_high_threshold: number;
};

export type RateItem = {
  id: string;
  category: "MATERIAL" | "PROCESS" | "LABOUR" | "OTHER" | "COMMERCIAL";
  name: string;
  grade: string;
  unit: string;
  price: number;
  critical_score: number;
  active: boolean;
  notes: string;
  updated_at: string;
};

export type RateCatalog = {
  materials: Record<string, string[]>;
  processes: string[];
  labour: string[];
  commercial: string[];
  units: string[];
};

export type DatasetStats = {
  extractions: number;
  reviewed_samples: number;
  training_samples: number;
  unique_files: number;
  dataset_version: number;
  new_reviewed_since_version: number;
  new_training_since_version: number;
  training_batch_threshold: number;
  batch_ready: boolean;
  auto_dataset_capture: boolean;
  learn_from_corrections: boolean;
};

export type QuoteRecord = {
  id: string;
  created_at: string;
  updated_at?: string;
  name?: string;
  customer: string;
  drawing_no: string;
  revision: string;
  description: string;
  selling_price: number;
  status: string;
};

export type RevisionRecord = {
  id: string;
  created_at: string;
  drawing_no: string;
  revision: string;
  description: string;
  material: string;
  note: string;
};


export type BatchQuoteItem = {
  drawing: DrawingDetails;
  rows: CostRow[];
  summary: QuoteSummary;
};

export type BatchQuoteMode = "separate" | "merge";


export type ArtifactStatus = "PROCESSING" | "READY" | "REVIEW" | "ATTENTION" | "FAILED";

export type DfmCheck = {
  area: string;
  result: "PASS" | "REVIEW" | "FAIL" | string;
  finding: string;
  recommendation: string;
  standard: string;
};

export type DfmProcessPlanRow = {
  sequence: number;
  process: string;
  tooling: string;
  feasibility: string;
  inspection: string;
};

export type DfmReport = {
  id: string;
  created_at: string;
  name: string;
  file_hash: string;
  filename: string;
  drawing_no: string;
  revision: string;
  description: string;
  classification: string;
  status: ArtifactStatus | string;
  standards: Array<{ standard: string; scope: string }>;
  checks: DfmCheck[];
  process_plan: DfmProcessPlanRow[];
  notes: string[];
};

export type BomItem = {
  item_no: number;
  category: string;
  description: string;
  material: string;
  specification: string;
  dimensions: string;
  quantity: number;
  unit: string;
  weight_kg: number;
  unit_cost: number;
  total_cost: number;
  source: string;
  remarks: string;
};

export type BomReport = {
  id: string;
  created_at: string;
  name: string;
  file_hash: string;
  filename: string;
  drawing_no: string;
  revision: string;
  description: string;
  status: ArtifactStatus | string;
  items: BomItem[];
  notes: string[];
};
