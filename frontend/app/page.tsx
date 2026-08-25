"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import ModelViewer from "@/components/ModelViewer";
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
  RevisionRecord,
  Settings
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


const BATCH_ANALYZE_CONCURRENCY = 2;
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
  [["material", "grade", "specification"], "sheet-summary-material"],
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
  if (!node) return;

  node.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  node.classList.add("review-focus");
  window.setTimeout(() => node.classList.remove("review-focus"), 1800);
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

  return values
    .filter((item) => item?.datasetId)
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))[0]
    || null;
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

export default function Page() {
  const [view, setView] = useState<View>("dashboard");
  const [sideOpen, setSideOpen] = useState(true);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [batchItems, setBatchItems] = useState<BatchWorkspace[]>([]);
  const batchItemsRef = useRef<BatchWorkspace[]>([]);
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
  const [showDfmHistory, setShowDfmHistory] = useState(false);
  const [showBomHistory, setShowBomHistory] = useState(false);
  const [workspaceDatasetId, setWorkspaceDatasetId] = useState(() => createWorkspaceDatasetId());
  const [workspaceDatasetName, setWorkspaceDatasetName] = useState("Untitled Quotation Dataset");
  const [workspaceDatasets, setWorkspaceDatasets] = useState<WorkspaceDatasetSummary[]>([]);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const historyReadyRef = useRef(false);
  const restoringHistoryRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("Ready.");
  const [fileUrl, setFileUrl] = useState("");

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
  const criticalName = (score: number) => criticalLabel(score, mediumCritical, highCritical);

  const refresh = useCallback(async () => {
    try {
      const [s, r, c, d, q] = await Promise.all([
        api.getSettings(),
        api.getRates(),
        api.getRateCatalog(),
        api.getDatasetStats(),
        api.getQuotes()
      ]);
      setSettings(s);
      setRates(r);
      setCatalog(c);
      setStats(d);
      setQuotes(q);
    } catch {
      // Backend connection message is handled by task-specific actions.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);


  // Use DFAB's website icon as both the sidebar brand source and browser tab icon.
  useEffect(() => {
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

    setFile(saved.file || null);
    setFiles(saved.files || (saved.file ? [saved.file] : []));
    setBatchItems(saved.batchItems || []);
    batchItemsRef.current = saved.batchItems || [];
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

  // Keep browser/system Back inside the application and return to the previous
  // app view/step instead of dropping the whole quotation session.
  useEffect(() => {
    if (!draftHydrated || historyReadyRef.current) return;

    history.replaceState(
      { dfabGuard: true },
      "",
      window.location.href
    );
    history.pushState(
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
  }, [draftHydrated, view, step]);

  useEffect(() => {
    if (!draftHydrated) return;

    const onPopState = (event: PopStateEvent) => {
      const state = event.state as {
        dfabApp?: boolean;
        dfabGuard?: boolean;
        view?: View;
        step?: number;
        datasetId?: string;
      } | null;

      if (state?.dfabApp) {
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
        return;
      }

      // Reached the guard state: stay inside the app.
      const targetView: View = view === "workflow" && step > 1
        ? "workflow"
        : "dashboard";
      const targetStep = view === "workflow" && step > 1
        ? step - 1
        : 1;

      restoringHistoryRef.current = true;
      setView(targetView);
      setStep(targetStep);

      history.pushState(
        { dfabApp: true, view: targetView, step: targetStep, datasetId: workspaceDatasetId },
        "",
        window.location.href
      );
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [draftHydrated, view, step]);

  useEffect(() => {
    if (!file) {
      setFileUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const newQuote = () => {
    void clearWorkflowDraft().catch(() => undefined);
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
    setShowDfmHistory(false);
    setShowBomHistory(false);
    setWorkspaceDatasetId(createWorkspaceDatasetId());
    setWorkspaceDatasetName("Untitled Quotation Dataset");
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
    setMsg("Upload a drawing to begin.");
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
    setFile(target.file);
    setAnalysis(target.analysis);
    setDrawing(target.drawing);
    setRows(target.rows);
    setSummary(target.summary);
    setFinalPriceOverride(null);
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
        setDfmReports((current) => [
          ...current.filter((item) => item.file_hash !== report.file_hash),
          report
        ]);
        setSelectedDfmId(report.id);
        setDfmJobs((current) => ({ ...current, [key]: "ready" }));
      }).catch(() => {
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
        setBomReports((current) => [
          ...current.filter((item) => item.file_hash !== report.file_hash),
          report
        ]);
        setSelectedBomId(report.id);
        setBomJobs((current) => ({ ...current, [key]: "ready" }));
      }).catch(() => {
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
      const attemptText = attempt > 1 ? ` · retry ${attempt}/2` : "";

      setAnalyzeProgress(`${originalIndex + 1}/${total}`);
      setMsg(
        `Analyzing drawing ${originalIndex + 1}/${total}: ${selected.name}${attemptText}`
      );

      try {
        const result = await api.analyzeDrawing(selected, true);
        const itemSummary = result.summary || await api.calculateQuote(result.rows);

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

    throw new Error(lastError);
  };

  const sortBatchBySelectedFiles = (items: BatchWorkspace[]) => {
    const order = new Map(
      files.map((selected, index) => [fileKey(selected), index])
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
          files.findIndex(
            (selected) => fileKey(selected) === fileKey(failure.file)
          )
        );

        try {
          recovered.push(
            await analyzeOneWithRetry(
              failure.file,
              originalIndex,
              files.length || batchItems.length + batchFailures.length
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
          `All ${files.length || analyzedCount} drawings analyzed successfully.`
        );
      } else {
        setMsg(
          `${analyzedCount} of ${files.length || analyzedCount + stillFailed.length} drawings analyzed. ${stillFailed.length} still need retry.`
        );
      }
    } finally {
      setAnalyzeProgress("");
      setBusy(false);
    }
  };

  const goWorkflowStep = (targetStep: number) => {
    if (targetStep === 4 && batchFailures.length > 0) {
      setMsg(
        `${batchFailures.length} drawing(s) still failed analysis. Retry them before preparing quotation.`
      );
      return;
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
    const selectedFiles = files.length
      ? files
      : (file ? [file] : []);

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
            ? `0 of ${selectedFiles.length} drawings analyzed. Use Retry Failed.`
            : "No drawings were analyzed."
        );
        return;
      }

      const first = ordered[0];

      setActiveBatchId(first.id);
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
            ? "1 drawing analyzed."
            : `All ${selectedFiles.length} drawings analyzed. Select a drawing number to review its details.`
        );
      } else {
        setMsg(
          `${ordered.length} of ${selectedFiles.length} drawings analyzed. ${failed.length} failed after 2 attempts — use Retry Failed.`
        );
      }

      void refresh();
    } finally {
      setAnalyzeProgress("");
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
          rows
        }),
        api.saveRevision({
          drawing,
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
    setAnalysis((current) => current ? { ...current, ai_raw: next } : current);

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
      width: 88,
      minWidth: 88,
      maxWidth: 88,
      sortable: false,
      resizable: false,
      cellRenderer: (p: { data?: CostRow }) => (
        <button
          type="button"
          className="grid-delete-btn"
          onClick={() => p.data && removeCostRow(p.data.id)}
        >
          Remove
        </button>
      )
    }
  ], [rows, rates, catalog]);

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
    void refresh();
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
  };

  const openEngineeringArtifact = (target: "dfm" | "bom") => {
    // Save the exact quotation/cost-sheet state before leaving the workflow.
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

  const selectedDfm = dfmReports.find((item) => item.id === selectedDfmId) || dfmReports.at(-1) || null;
  const selectedBom = bomReports.find((item) => item.id === selectedBomId) || bomReports.at(-1) || null;
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

  return (
    <main className={`app ${sideOpen ? "" : "sidebar-collapsed"}`}>
      <aside className={`side ${sideOpen ? "" : "closed"}`}>
        <button className="sidebar-toggle" type="button" onClick={() => setSideOpen(false)} title="Close menu" aria-label="Close menu">‹</button>
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
        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
          <button onClick={newQuote}>New Quotation</button>
          <button className={view === "quotes" ? "active" : ""} onClick={() => setView("quotes")}>Quotation History</button>
          <button className={view === "rates" ? "active" : ""} onClick={openRates}>Rate Master</button>
          <button className={view === "dfm" ? "active" : ""} onClick={() => openEngineeringArtifact("dfm")}>
            <span>DFM Report</span>
            <span className="artifact-nav-meta">
              <i className={`artifact-nav-light ${engineeringArtifactStage}`}/>
              <em>{dfmReports.length}</em>
            </span>
          </button>
          <button className={view === "bom" ? "active" : ""} onClick={() => openEngineeringArtifact("bom")}>
            <span>BOM</span>
            <span className="artifact-nav-meta">
              <i className={`artifact-nav-light ${engineeringArtifactStage}`}/>
              <em>{bomReports.length}</em>
            </span>
          </button>
          <button className={view === "dataset" ? "active" : ""} onClick={() => { setView("dataset"); void refresh(); void refreshWorkspaceDatasets(); }}>Dataset Learning</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
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
            <div className="cards four">
              <article><small>Total Quotations</small><b>{quotes.length}</b><span>Saved records</span></article>
              <article><small>Rate Master</small><b>{rates.filter(r => r.active).length}</b><span>Active saved rates</span></article>
              <article><small>Training Samples</small><b>{stats?.training_samples ?? 0}</b><span>Explicitly approved after quotation</span></article>
              <article><small>Dataset Version</small><b>v{stats?.dataset_version ?? 1}</b><span>{stats?.batch_ready ? "Training batch ready" : "Collecting reviewed samples"}</span></article>
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

            {(files.length > 1 || batchItems.length > 1) && step >= 2 && (
              <div className="drawing-selector-box">
                <div className="drawing-selector-title">
                  <div>
                    <span>BATCH DRAWINGS</span>
                    <b>
                      {batchItems.length} / {files.length || batchItems.length} drawings analyzed
                    </b>
                  </div>

                  <div className="batch-selector-actions">
                    <small>Click a drawing number to open its review, engineering sheet and cost.</small>

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
                  </div>
                </div>

                <div className="drawing-selector-list">
                  {batchItems.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.id === activeBatchId ? "active" : ""}
                      onClick={() => selectBatchDrawing(item.id)}
                    >
                      <small>{index + 1}</small>
                      <b>{item.drawing.drawing_no || "Not detected"}</b>
                      <span>Rev {item.drawing.revision || "—"}</span>
                    </button>
                  ))}
                </div>

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

                      // Same picker handles everything:
                      // PDF/Image/DXF/DWG -> quotation analysis
                      // STEP/STP/etc. -> automatically linked to DFM.
                      const nextDrawingFiles =
                        selectedDrawings.length > 0
                          ? selectedDrawings
                          : files;

                      const nextModel =
                        selectedModels[0]
                        || modelFile
                        || null;

                      const nextFile = nextDrawingFiles[0] || null;

                      setFiles(nextDrawingFiles);
                      setFile(nextFile);
                      setModelFile(nextModel);

                      if (selectedDrawings.length > 0) {
                        const sourceName = selectedDrawings[0].name.replace(/\.[^.]+$/, "");
                        setWorkspaceDatasetName(`Dataset - ${sourceName}`);
                      }

                      if (selectedDrawings.length > 0) {
                        setBatchItems([]);
                        batchItemsRef.current = [];
                        setBatchFailures([]);
                        setActiveBatchId("");
                        setAnalysis(null);
                        setDrawing(null);
                        setRows([]);
                        setSummary(emptySummary);
                      }

                      const drawingText =
                        nextDrawingFiles.length > 1
                          ? `${nextDrawingFiles.length} drawings`
                          : nextDrawingFiles.length === 1
                            ? nextDrawingFiles[0].name
                            : "no 2D drawing";

                      const modelText =
                        nextModel
                          ? ` + 3D model ${nextModel.name}`
                          : "";

                      setMsg(
                        selectedInputs.length
                          ? `${drawingText}${modelText} selected.${nextDrawingFiles.length ? " Click Analyze Drawing." : " Add a PDF/Image/DXF/DWG drawing to analyze."}`
                          : "Upload a drawing to begin."
                      );

                      // Allows choosing the same file again if needed.
                      e.target.value = "";
                    }}
                  />
                  <span>↑</span>
                  <b>
                    {files.length > 1
                      ? `${files.length} drawings selected${modelFile ? " + 3D model" : ""}`
                      : file?.name
                        ? `${file.name}${modelFile ? " + 3D model" : ""}`
                        : modelFile
                          ? `3D model linked · choose drawing`
                          : "Choose drawing(s)"}
                  </b>
                  <small>
                    PDF / Image / DXF / DWG / STEP / STP / GLB / GLTF / STL / OBJ / IGES / Parasolid
                  </small>
                  {modelFile && (
                    <em className="upload-linked-model">
                      3D linked: {modelFile.name} · automatically available in DFM
                    </em>
                  )}
                </label>

                {busy && (
                  <div className="drawing-analyze-loader" role="status" aria-live="polite">
                    <div className="loader-gear" aria-hidden="true">
                      <span/><span/><span/>
                    </div>
                    <div>
                      <b>Reading engineering drawing…</b>
                      <span>
                        {analyzeProgress
                          ? `Analyzing ${analyzeProgress} · dimensions → features → process → costing`
                          : "Preparing drawing for AI analysis"}
                      </span>
                    </div>
                    <div className="loader-track"><i/></div>
                  </div>
                )}

                {files.length > 1 && (
                  <div className="upload-file-strip">
                    {files.map((selected, index) => (
                      <span key={`${selected.name}-${index}`}>
                        {index + 1}. {selected.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="actions">
                  <button
                    className="btn primary"
                    disabled={(!file && !files.length) || busy}
                    onClick={analyze}
                  >
                    {busy
                      ? `Analyzing ${analyzeProgress || "..."}`
                      : files.length > 1
                        ? `Analyze ${files.length} Drawings`
                        : "Analyze Drawing"}
                  </button>
                </div>
              </section>
            )}

            {step === 2 && drawing && (
              <section className="panel">
                <div className="heading row">
                  <div><p className="eyebrow">STEP 2</p><h2>Drawing Snapshot & Basic Details</h2><p>Confirm the drawing identity and key values. Full engineering details stay in the Excel sheet.</p></div>
                  <div className="actions compact"><button className="btn primary" disabled={busy} onClick={saveReview}>Save Review & Continue</button></div>
                </div>
                <div className="extraction-status">
                  <span className={`source-badge ${analysis?.learning_source === "vision_ai" ? "good" : "warn"}`}>
                    Source: {analysis?.learning_source || "unknown"}
                  </span>
                  {analysis?.extraction_warnings?.map((warning, i) => (
                    <span className="extract-warning" key={i}>⚠ {warning}</span>
                  ))}
                </div>

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
                    <label><span>Thickness</span><div className="value-with-unit"><input type="number" step=".1" value={drawing.thickness_mm} onChange={(e) => setDrawing({ ...drawing, thickness_mm: +e.target.value })}/><em>mm</em></div></label>
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
                  <b>No numeric confidence scores are shown on this sheet.</b>
                </div>
                <div className="charge-cards">
                  <div><span>Material Charges</span><b>{money(chargeTotals.material)}</b></div>
                  <div><span>Processing Charges</span><b>{money(chargeTotals.process)}</b></div>
                  <div><span>Labour Charges</span><b>{money(chargeTotals.labour)}</b></div>
                </div>

                <div className="cost-grid-shell">
                  <div className="cost-grid-title">
                    <div><span>COSTING</span><b>Rate Master Cost Rows</b></div>
                    <div className="cost-grid-actions">
                      <small>All input fields are editable</small>
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
                                  <td>{qty}</td>
                                  <td>{money(unitPrice)}</td>
                                  <td><b>{money(total)}</b></td>
                                </tr>
                              );
                            })}
                          </tbody>

                          <tfoot>
                            <tr>
                              <td colSpan={6}>
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

                      <div className="dfm-model-grid">
                        <div>
                          <div className="artifact-subhead">
                            <div>
                              <b>3D Model Review</b>
                              <span>
                                {modelFile
                                  ? `${modelFile.name} · linked automatically from Choose drawing(s)`
                                  : "No 3D model linked · optional STEP / STP / GLB / GLTF can be added here"}
                              </span>
                            </div>
                            <label className="btn secondary file-button">
                              {modelFile ? "Replace 3D Model" : "Upload 3D Model"}
                              <input
                                type="file"
                                accept=".step,.stp,.glb,.gltf,.stl,.obj,.iges,.igs,.x_t,.x_b"
                                onChange={(e) => setModelFile(e.target.files?.[0] || null)}
                              />
                            </label>
                          </div>
                          <ModelViewer file={modelFile} issueCount={selectedDfm.checks.filter((item) => item.result !== "PASS").length}/>
                        </div>

                        <div>
                          <div className="artifact-subhead"><div><b>International DFM Reference Matrix</b><span>Feature-specific references; engineer must confirm applicability to the customer drawing</span></div></div>
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
                                          standards[index] = { ...standards[index], standard: e.target.value };
                                          updateDfm({ ...selectedDfm, standards });
                                        }}
                                      />
                                    </td>
                                    <td>
                                      <textarea
                                        value={item.scope}
                                        onChange={(e) => {
                                          const standards = [...selectedDfm.standards];
                                          standards[index] = { ...standards[index], scope: e.target.value };
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

  const setSummaryNumber = (
    key: "thickness_mm" | "weight_kg" | "product_quantity",
    value: string
  ) => {
    const nextValue = value.trim() === "" ? null : Number(value);

    onChange({
      ...data,
      [key]: key === "product_quantity"
        ? Math.max(1, Number(nextValue || 1))
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

  const processColumns: EditableColumn[] = [
    { key: "process", label: "Process" },
    { key: "reason", label: "Reason / Drawing Basis" }
  ];

  const finishes = (data.surface_finish || []).map((x) => String(x));
  const notes = (data.notes || []).map((x) => String(x));
  const uncertain = (data.missing_or_uncertain || []).map((x) => String(x));

  return (
    <div className="engineering-details vertical-edit-sheet">
      <section className="sheet-section">
        <div className="sheet-section-title">
          <div><span>01</span><div><b>Part Summary</b><small>Editable key engineering information</small></div></div>
        </div>

        <div className="editable-summary-table">
          <table>
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>
              <tr id="sheet-summary-material"><td>Material Family</td><td><input className="sheet-cell-input" value={data.material?.family || ""} onChange={(e) => setMaterial("family", e.target.value)}/></td></tr>
              <tr id="sheet-summary-grade"><td>Grade</td><td><input className="sheet-cell-input" value={data.material?.grade || ""} onChange={(e) => setMaterial("grade", e.target.value)}/></td></tr>
              <tr id="sheet-summary-specification"><td>Specification</td><td><input className="sheet-cell-input" value={data.material?.specification || ""} onChange={(e) => setMaterial("specification", e.target.value)}/></td></tr>
              <tr id="sheet-summary-thickness"><td>Thickness (mm)</td><td><input className="sheet-cell-input" type="number" step="any" value={data.thickness_mm ?? ""} onChange={(e) => setSummaryNumber("thickness_mm", e.target.value)}/></td></tr>
              <tr id="sheet-summary-weight"><td>Weight (kg)</td><td><input className="sheet-cell-input" type="number" step="any" value={data.weight_kg ?? ""} onChange={(e) => setSummaryNumber("weight_kg", e.target.value)}/></td></tr>
              <tr id="sheet-summary-quantity"><td>Product Quantity</td><td><input className="sheet-cell-input" type="number" min="1" step="1" value={data.product_quantity ?? 1} onChange={(e) => setSummaryNumber("product_quantity", e.target.value)}/></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="sheet-section">
        <div className="sheet-section-title">
          <div><span>02</span><div><b>Drawing Features</b><small>Full-width editable tables arranged one-by-one</small></div></div>
        </div>

        <div className="engineering-feature-stack">
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
          <div><span>03</span><div><b>Notes & Review</b><small>Editable drawing notes kept one table after another</small></div></div>
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
    </div>
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
