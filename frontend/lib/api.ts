import type {
  AnalysisResponse,
  BatchQuoteItem,
  BatchQuoteMode,
  CostRow,
  DatasetStats,
  DrawingDetails,
  QuoteRecord,
  QuoteSummary,
  RateCatalog,
  RateItem,
  RevisionRecord,
  Settings
} from "./types";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + url, init);
  if (!response.ok) throw new Error((await response.text()) || "Request failed");
  return response.json();
}

export async function analyzeDrawing(file: File, forceAI = true) {
  const form = new FormData();
  form.append("file", file);
  return j<AnalysisResponse>(`/api/analyze?force_ai=${forceAI ? "true" : "false"}`, {
    method: "POST",
    body: form
  });
}

export async function saveReview(payload: unknown) {
  return j("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function calculateQuote(rows: CostRow[]) {
  return j<QuoteSummary>("/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows })
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

export async function getDatasetStats() { return j<DatasetStats>("/api/dataset/stats"); }
export async function getQuotes() { return j<QuoteRecord[]>("/api/quotations"); }
export async function saveQuote(payload: unknown) {
  return j<QuoteRecord>("/api/quotations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
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
  await dl(await fetch(API + "/api/dataset/export"), "training_dataset.jsonl");
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
