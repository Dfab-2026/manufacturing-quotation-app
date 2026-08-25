import type {
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
  RevisionRecord,
  Settings
} from "./types";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

async function j<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 45000
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API + url, {
      ...init,
      signal: init?.signal || controller.signal
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "Request failed");
    }

    return response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out.");
    }

    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function analyzeFallback(
  file: File,
  reason: string
) {
  const extension = file.name.split(".").pop()?.toUpperCase() || "FILE";

  return j<AnalysisResponse>("/api/analyze-fallback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      source_format: extension,
      reason
    })
  }, 12000);
}

export async function analyzeCad(payload: {
  filename: string;
  file_hash: string;
  format: string;
  parser_status: string;
  root_name: string;
  part_count: number;
  mesh_count: number;
  triangle_count: number;
  dimensions_mm: { x: number; y: number; z: number };
  surface_area_mm2: number;
  volume_mm3: number;
  component_names: string[];
}) {
  return j<AnalysisResponse>("/api/analyze-cad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, 18000);
}

export async function analyzeDrawing(file: File, forceAI = true) {
  const form = new FormData();
  form.append("file", file);
  return j<AnalysisResponse>(`/api/analyze?force_ai=${forceAI ? "true" : "false"}`, {
    method: "POST",
    body: form
  }, 45000);
}

export async function saveReview(payload: unknown) {
  return j("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function calculateQuote(
  rows: CostRow[],
  commercial?: {
    material_wastage_pct?: number;
    overhead_pct?: number;
    markup_pct?: number;
    material_wastage_override?: number | null;
    overhead_override?: number | null;
    markup_override?: number | null;
    selling_price_override?: number | null;
  }
) {
  return j<QuoteSummary>("/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, ...(commercial || {}) })
  });
}

export async function getSettings() { return j<Settings>("/api/settings"); }
export async function saveSettings(value: Settings) {
  return j<Settings>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

export async function getRates() { return j<RateItem[]>("/api/rates"); }
export async function restoreDefaultRates() {
  return j<RateItem[]>("/api/rates/restore-defaults", {
    method: "POST"
  });
}
export async function getRateCatalog() { return j<RateCatalog>("/api/rate-catalog"); }
export async function addRate(value: RateItem) {
  return j<RateItem>("/api/rates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}
export async function updateRate(value: RateItem) {
  return j<RateItem>(`/api/rates/${encodeURIComponent(value.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}
export async function deleteRate(id: string) {
  return j(`/api/rates/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function applySavedRates(rows: CostRow[]) {
  return j<CostRow[]>("/api/rates/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows })
  });
}


export async function syncCostRowRate(
  row: CostRow,
  material?: {
    family?: string;
    grade?: string;
    specification?: string;
  }
) {
  return j<{ row: CostRow; rate: RateItem }>("/api/rates/sync-row", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      row,
      material_family: material?.family || "",
      material_grade: material?.grade || "",
      material_specification: material?.specification || ""
    })
  });
}

export async function generateDfm(payload: {
  fileHash: string;
  filename: string;
  drawing: DrawingDetails;
  rows: CostRow[];
  aiRaw?: unknown;
}) {
  return j<DfmReport>("/api/dfm/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_hash: payload.fileHash,
      filename: payload.filename,
      drawing: payload.drawing,
      rows: payload.rows,
      ai_raw: payload.aiRaw || {}
    })
  });
}

export async function generateBom(payload: {
  fileHash: string;
  filename: string;
  drawing: DrawingDetails;
  rows: CostRow[];
  aiRaw?: unknown;
}) {
  return j<BomReport>("/api/bom/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_hash: payload.fileHash,
      filename: payload.filename,
      drawing: payload.drawing,
      rows: payload.rows,
      ai_raw: payload.aiRaw || {}
    })
  });
}

export async function exportDfm(report: DfmReport) {
  await dl(await fetch(API + "/api/dfm/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report)
  }), "dfm-report.pdf");
}

export async function exportBomPdf(report: BomReport) {
  await dl(await fetch(API + "/api/bom/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report)
  }), "bom.pdf");
}

export async function getDatasetStats() { return j<DatasetStats>("/api/dataset/stats"); }
export async function sendTrainingSample(payload: {
  file: File;
  extractionId: string;
  fileHash: string;
  customer: string;
  drawing: DrawingDetails;
  rows: CostRow[];
  summary: QuoteSummary;
  aiRaw?: unknown;
}) {
  const form = new FormData();
  form.append("file", payload.file);
  form.append("extraction_id", payload.extractionId || "");
  form.append("file_hash", payload.fileHash || "");
  form.append("customer", payload.customer || "");
  form.append("drawing_json", JSON.stringify(payload.drawing));
  form.append("rows_json", JSON.stringify(payload.rows));
  form.append("summary_json", JSON.stringify(payload.summary));
  form.append("ai_raw_json", JSON.stringify(payload.aiRaw || {}));

  return j<{
    status: string;
    id: string;
    drawing_no: string;
    training_samples: number;
  }>("/api/dataset/training", {
    method: "POST",
    body: form
  });
}
export async function getQuotes() { return j<QuoteRecord[]>("/api/quotations"); }
export async function saveQuote(payload: unknown) {
  return j<QuoteRecord>("/api/quotations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
export async function renameQuote(id: string, name: string) {
  return j<QuoteRecord>(`/api/quotations/${encodeURIComponent(id)}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
}

export async function deleteQuote(id: string) {
  return j<{ status: string; id: string }>(
    `/api/quotations/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}
export async function getRevisions(drawingNo: string) {
  return j<RevisionRecord[]>(`/api/revisions/${encodeURIComponent(drawingNo)}`);
}
export async function saveRevision(payload: unknown) {
  return j<RevisionRecord>("/api/revisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function dl(response: Response, fallback: string) {
  if (!response.ok) throw new Error("Export failed");
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^\"]+)"?/i);
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = match?.[1] || fallback;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportExcel(drawing: DrawingDetails, rows: CostRow[], summary: QuoteSummary) {
  await dl(await fetch(API + "/api/export/excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drawing, rows, summary })
  }), "costing.xlsx");
}

export async function exportPdf(drawing: DrawingDetails, rows: CostRow[], summary: QuoteSummary, customer: string) {
  await dl(await fetch(API + "/api/export/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drawing, rows, summary, customer })
  }), "quotation.pdf");
}

export async function exportDataset() {
  await dl(await fetch(API + "/api/dataset/export"), "quotation_training_dataset.zip");
}


export async function saveBatchQuote(
  customer: string,
  mode: BatchQuoteMode,
  items: BatchQuoteItem[],
  status = "Draft"
) {
  return j<{
    mode: BatchQuoteMode;
    count: number;
    id: string;
    records: QuoteRecord[];
  }>("/api/quotations/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer, mode, items, status })
  });
}

export async function exportBatchPdf(
  customer: string,
  mode: BatchQuoteMode,
  items: BatchQuoteItem[]
) {
  const fallback = mode === "merge"
    ? "merged_quotation.pdf"
    : "separate_quotations.zip";

  await dl(await fetch(API + "/api/export/pdf-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer, mode, items })
  }), fallback);
}


export async function saveWorkspaceSession(
  sessionId: string,
  name: string,
  payload: Record<string, unknown>
) {
  return j<{ status: string; id: string; updated_at: string }>(
    `/api/workspaces/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload })
    }
  );
}

export async function uploadWorkspaceFile(
  sessionId: string,
  file: File,
  role: "drawing" | "model" = "drawing"
) {
  const form = new FormData();
  form.append("role", role);
  form.append("file", file);

  return j<{
    status: string;
    id: string;
    filename: string;
    role: string;
    size_bytes: number;
    file_hash: string;
  }>(
    `/api/workspaces/${encodeURIComponent(sessionId)}/files`,
    { method: "POST", body: form }
  );
}


export async function deleteWorkspaceSession(sessionId: string) {
  return j<{ status: string; id: string }>(
    `/api/workspaces/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
    12000
  );
}
