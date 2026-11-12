"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveSuggestedProcessRoutes } from "@/app/(app)/rfqs/[id]/actions";

type Suggestion = {
  sequence?: number;
  operation?: string;
  work_center?: string | null;
  reason?: string | null;
  confidence?: number;
};

type Row = {
  enabled: boolean;
  operation: string;
  workCenter: string;
  setupMinutes: number;
  cycleMinutes: number;
  quantity: number;
  confidence: number;
  reason: string;
};

type Props = {
  rfqId: string;
  partId: string;
  partName: string;
  quantity: number;
  suggestions: Suggestion[];
};

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving process route…" : "Save approved process route"}</button>;
}

export function ProcessPlanning({ rfqId, partId, partName, quantity, suggestions }: Props) {
  const initial = useMemo<Row[]>(() => suggestions.map((item, index) => ({
    enabled: true,
    operation: item.operation || `Operation ${index + 1}`,
    workCenter: item.work_center || "",
    setupMinutes: 0,
    cycleMinutes: 0,
    quantity,
    confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
    reason: item.reason || ""
  })), [suggestions, quantity]);
  const [rows, setRows] = useState(initial);

  const update = <K extends keyof Row>(index: number, key: K, value: Row[K]) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  };

  const addRow = () => setRows((current) => [...current, {
    enabled: true, operation: "", workCenter: "", setupMinutes: 0, cycleMinutes: 0,
    quantity, confidence: 1, reason: "Estimator-added operation"
  }]);
  const removeRow = (index: number) => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));

  return (
    <form action={saveSuggestedProcessRoutes} className="process-planner card">
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="partId" value={partId} />
      <input type="hidden" name="routesJson" value={JSON.stringify(rows)} />
      <div className="card-head process-planner-head">
        <div><span className="eyebrow">AI manufacturing plan</span><h2>{partName}</h2><p>AI suggests the shop-floor sequence from the reviewed drawing. Edit, disable or add operations before approval.</p></div>
        <button type="button" className="btn btn-sm" onClick={addRow}>＋ Add operation</button>
      </div>
      <div className="process-route-list">
        {rows.length ? rows.map((row, index) => (
          <div className={`process-route-card ${row.enabled ? "" : "process-route-disabled"}`} key={`${index}-${row.operation}`}>
            <div className="process-sequence">{index + 1}</div>
            <div className="process-route-main">
              <div className="process-route-top">
                <label className="process-enable"><input type="checkbox" checked={row.enabled} onChange={(e) => update(index, "enabled", e.target.checked)} /> Use</label>
                <span className={`confidence ${row.confidence >= .9 ? "confidence-high" : row.confidence >= .7 ? "confidence-medium" : "confidence-low"}`}>{Math.round(row.confidence * 100)}% AI confidence</span>
                <button className="btn btn-sm btn-danger" type="button" onClick={() => removeRow(index)}>Remove</button>
              </div>
              <div className="form-grid process-route-grid">
                <div className="field"><label>Operation</label><input className="input" value={row.operation} onChange={(e) => update(index, "operation", e.target.value)} required={row.enabled} /></div>
                <div className="field"><label>Work center / machine type</label><input className="input" value={row.workCenter} onChange={(e) => update(index, "workCenter", e.target.value)} placeholder="e.g. Fiber laser / VMC / TIG bay" /></div>
                <div className="field field-4"><label>Setup min</label><input className="input" type="number" min="0" step="0.01" value={row.setupMinutes} onChange={(e) => update(index, "setupMinutes", Number(e.target.value) || 0)} /></div>
                <div className="field field-4"><label>Cycle min / pc</label><input className="input" type="number" min="0" step="0.01" value={row.cycleMinutes} onChange={(e) => update(index, "cycleMinutes", Number(e.target.value) || 0)} /></div>
                <div className="field field-4"><label>Qty</label><input className="input" type="number" min="0.001" step="0.001" value={row.quantity} onChange={(e) => update(index, "quantity", Number(e.target.value) || quantity)} /></div>
                <div className="field field-full"><label>Why AI selected this process</label><textarea className="textarea" value={row.reason} onChange={(e) => update(index, "reason", e.target.value)} /></div>
              </div>
            </div>
          </div>
        )) : <div className="empty"><strong>No confident manufacturing route was found</strong>Add the required shop-floor operations manually. AI intentionally leaves the route empty when drawing evidence is insufficient.</div>}
      </div>
      <div className="process-planner-footer"><div><strong>Times stay estimator-controlled</strong><span>AI recommends the route only. Setup time, cycle time, rates and final price are not invented by AI.</span></div><SaveButton /></div>
    </form>
  );
}
