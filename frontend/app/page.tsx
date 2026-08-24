"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import * as api from "@/lib/api";
import type {
  AIExtraction,
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
  Settings
} from "@/lib/types";

type View = "dashboard" | "workflow" | "quotes" | "rates" | "dataset" | "settings";
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

  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [drawing, setDrawing] = useState<DrawingDetails | null>(null);
  const [rows, setRows] = useState<CostRow[]>([]);
  const [summary, setSummary] = useState<QuoteSummary>(emptySummary);
  const [customer, setCustomer] = useState("Sample Customer");
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
    setAnalysis(null);
    setDrawing(null);
    setRows([]);
    setSummary(emptySummary);
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

  const analyzeOneWithRetry = async (
    selected: File,
    originalIndex: number,
    total: number
  ): Promise<BatchWorkspace> => {
    let lastError = "Analyze failed";

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const attemptText = attempt > 1 ? ` · retry ${attempt}/3` : "";

      setAnalyzeProgress(`${originalIndex + 1}/${total}`);
      setMsg(
        `Analyzing drawing ${originalIndex + 1}/${total}: ${selected.name}${attemptText}`
      );

      try {
        const result = await api.analyzeDrawing(selected, true);
        const itemSummary = await api.calculateQuote(result.rows);

        return {
          id: `${result.file_hash}-${originalIndex}`,
          file: selected,
          analysis: result,
          drawing: result.drawing,
          rows: result.rows,
          summary: itemSummary
        };
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : "Analyze failed";

        if (attempt < 3) {
          await wait(900 * attempt);
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

  const recalc = useCallback(async (nextRows: CostRow[]) => {
    const updated = nextRows.map((row) => ({
      ...row,
      cost: (+row.costingQty || 0) * (+row.rate || 0)
    }));
    setRows(updated);
    try {
      setSummary(await api.calculateQuote(updated));
    } catch {
      setMsg("Could not recalculate. Check backend connection.");
    }
  }, []);

  const analyze = async () => {
    const selectedFiles = files.length
      ? files
      : (file ? [file] : []);

    if (!selectedFiles.length) return;

    setAnalysis(null);
    setDrawing(null);
    setRows([]);
    setSummary(emptySummary);
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
          `${ordered.length} of ${selectedFiles.length} drawings analyzed. ${failed.length} failed after 3 attempts — use Retry Failed.`
        );
      }

      await refresh();
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
      await api.saveReview({
        extraction_id: analysis.extraction_id,
        file_hash: analysis.file_hash,
        drawing,
        rows
      });
      await api.saveRevision({ drawing, note: "Reviewed extraction saved" });
      await refresh();
      setStep(3);
      setMsg("Review saved. Continue with engineering and costing.");
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

    const shouldSyncRate = [
      "category",
      "item",
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
      minWidth: 115,
      maxWidth: 145
    },
    {
      field: "item",
      headerName: "Item / Process",
      editable: true,
      minWidth: 230,
      flex: 1.5
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
      minWidth: 105,
      valueParser: (p) => Number(p.newValue) || 0
    },
    {
      field: "unit",
      headerName: "Unit",
      editable: true,
      minWidth: 80,
      maxWidth: 100
    },
    {
      field: "rate",
      headerName: "Rate",
      editable: true,
      minWidth: 115,
      valueParser: (p) => Number(p.newValue) || 0,
      valueFormatter: (p) => money(Number(p.value || 0))
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
      valueFormatter: (p) => money(Number(p.value || 0))
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
  ], [rows]);

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
      return;
    }

    await api.exportBatchPdf(
      customer,
      quoteMode,
      items
    );
  };

  const openRates = () => {
    setView("rates");
    setRateTab("MATERIAL");
    setRateSearch("");
    void refresh();
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
      updateRateLocal(saved.id, saved);
      setMsg(`${saved.name}${saved.grade ? ` / ${saved.grade}` : ""} rate saved.`);
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
  const gradeOptions = draftRate.category === "MATERIAL"
    ? (catalog?.materials[draftRate.name] || [])
    : [];

  const addRate = async () => {
    const grade = draftRate.grade === "__CUSTOM__" ? customGrade.trim() : draftRate.grade;
    const payload: RateItem = { ...draftRate, grade };
    if (!payload.name.trim()) return setMsg("Enter/select an item name.");
    if (payload.category === "MATERIAL" && !payload.grade.trim()) return setMsg("Select or enter a material grade.");
    if (!payload.unit.trim()) return setMsg("Enter a unit.");
    try {
      const saved = await api.addRate(payload);
      setRates((current) => [...current, saved]);
      setDraftRate(blankRate());
      setCustomGrade("");
      setShowAddRate(false);
      setRateTab(saved.category);
      setMsg("New rate added to Rate Master.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not add rate.");
    }
  };

  return (
    <main className={`app ${sideOpen ? "" : "sidebar-collapsed"}`}>
      <aside className={`side ${sideOpen ? "" : "closed"}`}>
        <button className="sidebar-toggle" type="button" onClick={() => setSideOpen(false)} title="Close menu" aria-label="Close menu">‹</button>
        <div className="brand">
          <span>AQ</span>
          <div><b>AI Quotation</b><small>Manufacturing Costing</small></div>
        </div>
        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
          <button onClick={newQuote}>New Quotation</button>
          <button className={view === "quotes" ? "active" : ""} onClick={() => setView("quotes")}>Quotation History</button>
          <button className={view === "rates" ? "active" : ""} onClick={openRates}>Rate Master</button>
          <button className={view === "dataset" ? "active" : ""} onClick={() => { setView("dataset"); void refresh(); }}>Dataset Learning</button>
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
              <article><small>Reviewed Samples</small><b>{stats?.reviewed_samples ?? 0}</b><span>Engineer-corrected dataset</span></article>
              <article><small>Dataset Version</small><b>v{stats?.dataset_version ?? 1}</b><span>{stats?.batch_ready ? "Training batch ready" : "Collecting reviewed samples"}</span></article>
            </div>
            <div className="panel">
              <div className="heading row">
                <div><p className="eyebrow">START</p><h2>Drawing → Costing → Quotation</h2><p>Cost rows pull rates and criticality directly from the Rate Master.</p></div>
                <button className="btn primary" onClick={newQuote}>Upload New Drawing</button>
              </div>
              <Recent quotes={quotes} />
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
                    accept=".pdf,.png,.jpg,.jpeg,.dxf,.dwg"
                    onChange={(e) => {
                      const nextFiles = Array.from(e.target.files || []);
                      const nextFile = nextFiles[0] || null;

                      setFiles(nextFiles);
                      setFile(nextFile);
                      setBatchItems([]);
                      batchItemsRef.current = [];
                      setBatchFailures([]);
                      setActiveBatchId("");
                      setAnalysis(null);
                      setDrawing(null);
                      setRows([]);
                      setSummary(emptySummary);

                      setMsg(
                        nextFiles.length > 1
                          ? `${nextFiles.length} drawings selected. Click Analyze Drawings.`
                          : nextFile
                            ? `Selected ${nextFile.name}. Click Analyze Drawing.`
                            : "Upload a drawing to begin."
                      );
                    }}
                  />
                  <span>↑</span>
                  <b>
                    {files.length > 1
                      ? `${files.length} drawings selected`
                      : file?.name || "Choose drawing(s)"}
                  </b>
                  <small>PDF / Image / DXF / DWG · single or multiple files</small>
                </label>

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
                      {analysis?.preview_image
                        ? <img src={analysis.preview_image} alt="First-page drawing snapshot"/>
                        : fileUrl && file && file.type.startsWith("image/")
                          ? <img src={fileUrl} alt="Uploaded drawing"/>
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
                <SummaryView summary={summary} medium={mediumCritical} high={highCritical}/>
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
                      medium={mediumCritical}
                      high={highCritical}
                    />
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {view === "quotes" && (
          <section className="panel"><div className="heading"><p className="eyebrow">HISTORY</p><h2>Quotation History</h2><p>Saved draft and released quotation records.</p></div><Recent quotes={quotes}/></section>
        )}

        {view === "rates" && (
          <section className="panel rate-panel">
            <div className="heading row">
              <div><p className="eyebrow">ADMIN · COST CONTROL</p><h2>Rate Master</h2><p>Select material + grade or any process/labour item, edit its rate, and set its criticality.</p></div>
              <button className="btn primary" onClick={() => { setDraftRate(blankRate()); setCustomGrade(""); setShowAddRate(true); }}>+ Add Rate</button>
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
                <div className="add-rate-title"><div><b>Add New Rate</b><span>Saved items become available to future costing rows.</span></div><button className="icon-btn" onClick={() => setShowAddRate(false)}>×</button></div>
                <div className="add-rate-grid">
                  <label>Category<select value={draftRate.category} onChange={(e) => {
                    const category = e.target.value as RateItem["category"];
                    if (category === "MATERIAL") setDraftRate({ ...draftRate, category, name: materialNames[0] || "Stainless Steel", grade: catalog?.materials[materialNames[0] || "Stainless Steel"]?.[0] || "", unit: "kg" });
                    else if (category === "PROCESS") setDraftRate({ ...draftRate, category, name: catalog?.processes[0] || "Laser Cutting", grade: "", unit: "job" });
                    else if (category === "LABOUR") setDraftRate({ ...draftRate, category, name: catalog?.labour[0] || "Fabricator", grade: "", unit: "hr" });
                    else if (category === "COMMERCIAL") setDraftRate({ ...draftRate, category, name: catalog?.commercial[0] || "Material Wastage", grade: "", unit: "%" });
                    else setDraftRate({ ...draftRate, category, name: "Packing", grade: "", unit: "job" });
                  }}><option value="MATERIAL">Material</option><option value="PROCESS">Process</option><option value="LABOUR">Labour</option><option value="COMMERCIAL">Commercial</option><option value="OTHER">Other</option></select></label>

                  {draftRate.category === "MATERIAL" ? (
                    <>
                      <label>Material Name<select value={draftRate.name} onChange={(e) => { const name = e.target.value; setDraftRate({ ...draftRate, name, grade: catalog?.materials[name]?.[0] || "" }); }}>
                        {materialNames.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select></label>
                      <label>Grade<select value={draftRate.grade} onChange={(e) => setDraftRate({ ...draftRate, grade: e.target.value })}>
                        {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                        <option value="__CUSTOM__">+ Custom Grade</option>
                      </select></label>
                      {draftRate.grade === "__CUSTOM__" && <label>Custom Grade<input value={customGrade} onChange={(e) => setCustomGrade(e.target.value)} placeholder="e.g. EN 1.4404"/></label>}
                    </>
                  ) : draftRate.category === "PROCESS" ? (
                    <label>Process<select value={draftRate.name} onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value })}>{catalog?.processes.map((name) => <option key={name}>{name}</option>)}</select></label>
                  ) : draftRate.category === "LABOUR" ? (
                    <label>Labour Type<select value={draftRate.name} onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value })}>{catalog?.labour.map((name) => <option key={name}>{name}</option>)}</select></label>
                  ) : draftRate.category === "COMMERCIAL" ? (
                    <label>Commercial Cost<select value={draftRate.name} onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value, unit: "%" })}>{catalog?.commercial.map((name) => <option key={name}>{name}</option>)}</select></label>
                  ) : (
                    <label>Item Name<input value={draftRate.name} onChange={(e) => setDraftRate({ ...draftRate, name: e.target.value })}/></label>
                  )}

                  <label>Unit<select value={draftRate.unit} onChange={(e) => setDraftRate({ ...draftRate, unit: e.target.value })}>{catalog?.units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
                  <label>Rate / Price<input type="number" min="0" step="0.01" value={draftRate.price} onChange={(e) => setDraftRate({ ...draftRate, price: +e.target.value })}/></label>
                  <label>Critical Score (0–100)<input type="number" min="0" max="100" value={draftRate.critical_score} onChange={(e) => setDraftRate({ ...draftRate, critical_score: Math.max(0, Math.min(100, +e.target.value)) })}/></label>
                  <label className="wide">Notes<input value={draftRate.notes} onChange={(e) => setDraftRate({ ...draftRate, notes: e.target.value })} placeholder="Supplier/source/validity note"/></label>
                </div>
                <div className="actions"><button className="btn secondary" onClick={() => setShowAddRate(false)}>Cancel</button><button className="btn primary" onClick={addRate}>Add to Rate Master</button></div>
              </div>
            )}

            <div className="rate-table-wrap">
              <table className="rate-table">
                <thead><tr><th>Category</th><th>Material / Item</th><th>Grade</th><th>Unit</th><th>Rate</th><th>Critical Score</th><th>Active</th><th>Notes</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredRates.map((rate) => (
                    <tr key={rate.id}>
                      <td><span className={`category-pill ${rate.category.toLowerCase()}`}>{rate.category}</span></td>
                      <td><input value={rate.name} onChange={(e) => updateRateLocal(rate.id, { name: e.target.value })}/></td>
                      <td><input value={rate.grade} placeholder="—" onChange={(e) => updateRateLocal(rate.id, { grade: e.target.value })}/></td>
                      <td><input className="small-input" value={rate.unit} onChange={(e) => updateRateLocal(rate.id, { unit: e.target.value })}/></td>
                      <td><input className="price-input" type="number" min="0" step="0.01" value={rate.price} onChange={(e) => updateRateLocal(rate.id, { price: +e.target.value })}/></td>
                      <td><div className="score-edit"><input type="number" min="0" max="100" value={rate.critical_score} onChange={(e) => updateRateLocal(rate.id, { critical_score: Math.max(0, Math.min(100, +e.target.value)) })}/><span className={`score-badge ${criticalName(rate.critical_score).toLowerCase()}`}>{criticalName(rate.critical_score)}</span></div></td>
                      <td><label className="switch"><input type="checkbox" checked={rate.active} onChange={(e) => updateRateLocal(rate.id, { active: e.target.checked })}/><span/></label></td>
                      <td><input value={rate.notes} onChange={(e) => updateRateLocal(rate.id, { notes: e.target.value })}/></td>
                      <td><div className="row-actions"><button className="mini save" onClick={() => saveRateRow(rate)}>Save</button><button className="mini delete" onClick={() => removeRate(rate.id)}>Delete</button></div></td>
                    </tr>
                  ))}
                  {!filteredRates.length && <tr><td colSpan={9} className="empty-cell">No matching rates.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="rate-footnote">Starter prices are placeholders for configuration. Replace them with your approved company/supplier rates before using quotations commercially.</p>
          </section>
        )}

        {view === "dataset" && (
          <section className="panel">
            <div className="heading row"><div><p className="eyebrow">CONTINUOUS LEARNING</p><h2>Dataset Learning</h2><p>Every extraction is captured; reviewed corrections become supervised training samples.</p></div><button className="btn secondary" onClick={() => api.exportDataset()}>Export JSONL Dataset</button></div>
            <div className="cards four"><article><small>Extractions</small><b>{stats?.extractions ?? 0}</b></article><article><small>Reviewed</small><b>{stats?.reviewed_samples ?? 0}</b></article><article><small>Unique Files</small><b>{stats?.unique_files ?? 0}</b></article><article><small>Dataset Version</small><b>v{stats?.dataset_version ?? 1}</b></article></div>
            <div className="notice"><b>{stats?.batch_ready ? "Training batch is ready." : "Collecting reviewed samples."}</b><span>Reviewed since current version: {stats?.new_reviewed_since_version ?? 0} / {stats?.training_batch_threshold ?? 25}</span><span>Corrections are reused immediately for identical drawing hashes. Model-weight retraining remains a validated batch step after the real AI extractor is connected.</span></div>
          </section>
        )}

        {view === "settings" && settings && (
          <SettingsEditor value={settings} setValue={setSettings} save={async () => { await api.saveSettings(settings); await refresh(); setMsg("Settings saved."); }}/>
        )}
      </section>
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

function SummaryView({ summary }: { summary: QuoteSummary; medium: number; high: number }) {
  return (
    <div className="summary clean-summary">
      <div><span>Direct Cost</span><b>{money(summary.direct_cost)}</b><small>Cost rows above</small></div>
      <div><span>Material Wastage</span><b>{money(summary.material_wastage)}</b><small>{summary.material_wastage_pct}%</small></div>
      <div><span>Overhead</span><b>{money(summary.overhead)}</b><small>{summary.overhead_pct}%</small></div>
      <div className="blue"><span>Manufacturing Cost</span><b>{money(summary.manufacturing_cost)}</b><small>Calculated total</small></div>
      <div><span>Markup</span><b>{money(summary.markup)}</b><small>{summary.markup_pct}%</small></div>
      <div className="green"><span>Selling Price</span><b>{money(summary.selling_price)}</b><small>Before tax / transport</small></div>
    </div>
  );
}

function Recent({ quotes }: { quotes: QuoteRecord[] }) {
  return (
    <div className="table">
      <div className="tr th"><span>Quote ID</span><span>Drawing</span><span>Revision</span><span>Customer</span><span>Status</span><span>Amount</span></div>
      {quotes.length ? quotes.slice().reverse().map((quote) => (
        <div className="tr" key={quote.id}><span>{quote.id}</span><span>{quote.drawing_no}</span><span>{quote.revision}</span><span>{quote.customer}</span><span>{quote.status}</span><span>{money(quote.selling_price)}</span></div>
      )) : <div className="empty">No saved quotations yet.</div>}
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
