"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useFormStatus } from "react-dom";
import { getDensity } from "@mq/core";
import { acceptReviewedExtraction } from "@/app/(app)/rfqs/[id]/actions";

type ExtractionField = {
  value?: string | number | null;
  confidence?: number;
  evidence?: string | null;
  source?: string | null;
};

type ExtractionData = Record<string, ExtractionField | string[] | undefined>;

type Props = {
  rfqId: string;
  drawingId: string;
  fileName: string;
  mimeType: string;
  extracted: ExtractionData;
  warnings: string[];
  nextPath?: string;
};

type ReviewValues = {
  drawingNumber: string;
  revision: string;
  description: string;
  material: string;
  quantity: string;
  lengthMm: string;
  widthMm: string;
  thicknessMm: string;
  diameterMm: string;
  drawingWeightKg: string;
  scrapPercent: string;
  tolerance: string;
  surfaceFinish: string;
  weldDetails: string;
  holeThreadDetails: string;
  heatTreatment: string;
  coating: string;
};

const field = (data: ExtractionData, key: string) =>
  (data[key] && !Array.isArray(data[key]) ? data[key] : {}) as ExtractionField;

const text = (value: unknown, fallback = "") =>
  value === null || value === undefined ? fallback : String(value);

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary review-submit" disabled={pending} type="submit">
      {pending ? "Saving reviewed part…" : "Approve & continue"}
    </button>
  );
}

function Confidence({ item }: { item: ExtractionField }) {
  const score = Math.round((item.confidence ?? 0) * 100);
  const level = score >= 90 ? "high" : score >= 70 ? "medium" : "low";
  return (
    <span className={`confidence confidence-${level}`} title={item.evidence ?? undefined}>
      {score}% confidence
    </span>
  );
}

export function ExtractionReview({ rfqId, drawingId, fileName, mimeType, extracted, warnings, nextPath }: Props) {
  const initial: ReviewValues = {
    drawingNumber: text(field(extracted, "drawing_number").value),
    revision: text(field(extracted, "revision").value),
    description: text(field(extracted, "description").value, "Drawing item"),
    material: text(field(extracted, "material").value),
    quantity: text(field(extracted, "quantity").value, "1"),
    lengthMm: text(field(extracted, "length_mm").value),
    widthMm: text(field(extracted, "width_mm").value),
    thicknessMm: text(field(extracted, "thickness_mm").value),
    diameterMm: text(field(extracted, "diameter_mm").value),
    drawingWeightKg: text(field(extracted, "drawing_weight_kg").value),
    scrapPercent: "5",
    tolerance: text(field(extracted, "tolerance").value),
    surfaceFinish: text(field(extracted, "surface_finish").value),
    weldDetails: text(field(extracted, "weld_details").value),
    holeThreadDetails: text(field(extracted, "hole_thread_details").value),
    heatTreatment: text(field(extracted, "heat_treatment").value),
    coating: text(field(extracted, "coating").value)
  };

  const [values, setValues] = useState(initial);

  const confidenceSummary = useMemo(() => {
    const keys = [
      "drawing_number", "revision", "description", "material", "quantity",
      "length_mm", "width_mm", "thickness_mm", "diameter_mm", "drawing_weight_kg",
      "tolerance", "surface_finish", "weld_details", "hole_thread_details", "heat_treatment", "coating"
    ];
    const scores = keys
      .map((key) => field(extracted, key))
      .filter((item) => item.value !== null && item.value !== undefined && item.value !== "")
      .map((item) => item.confidence ?? 0);
    return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) : 0;
  }, [extracted]);

  const calculatedWeight = useMemo(() => {
    const stated = Number(values.drawingWeightKg);
    const scrap = Number(values.scrapPercent) || 0;
    if (stated > 0) {
      return {
        source: "Drawing stated",
        net: stated,
        raw: stated * (1 + scrap / 100),
        note: "Drawing weight has priority. Scrap is added only to raw purchase weight."
      };
    }

    const materialCode = values.material.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const density = getDensity(materialCode);
    const length = Number(values.lengthMm);
    const width = Number(values.widthMm);
    const thickness = Number(values.thicknessMm);
    if (density && length > 0 && width > 0 && thickness > 0) {
      const net = (length * width * thickness / 1_000_000_000) * density.kgPerM3;
      return {
        source: "Calculated geometry",
        net,
        raw: net * (1 + scrap / 100),
        note: `${materialCode} density ${density.kgPerM3.toLocaleString("en-IN")} kg/m³ · plate volume × density.`
      };
    }

    return {
      source: "Not available",
      net: null,
      raw: null,
      note: "Enter drawing weight, or a supported material plus length, width and thickness."
    };
  }, [values]);

  const set = (key: keyof ReviewValues) => (event: ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const renderField = (
    label: string,
    name: keyof ReviewValues,
    extractionKey: string,
    options?: { unit?: string; type?: "text" | "number"; required?: boolean; step?: string }
  ) => {
    const item = field(extracted, extractionKey);
    return (
      <div className="review-field">
        <div className="review-field-head">
          <label htmlFor={`review-${name}`}>{label}</label>
          <Confidence item={item} />
        </div>
        <div className="review-input-wrap">
          <input
            className="input"
            id={`review-${name}`}
            name={name}
            type={options?.type ?? "text"}
            step={options?.step}
            min={options?.type === "number" ? "0" : undefined}
            required={options?.required}
            value={values[name]}
            onChange={set(name)}
          />
          {options?.unit && <span className="review-unit">{options.unit}</span>}
        </div>
        <div className="review-evidence" title={item.evidence ?? undefined}>
          <span>{item.source === "drawing" ? "Drawing" : item.source ? item.source : "No source"}</span>
          <span className="review-evidence-text">{item.evidence || "No direct evidence captured"}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="review-workspace">
      <aside className="drawing-pane">
        <div className="drawing-toolbar">
          <div>
            <strong>{fileName}</strong>
            <span>{mimeType === "application/pdf" ? "PDF drawing" : "Image drawing"}</span>
          </div>
          <a className="btn btn-sm" href={`/api/drawings/${drawingId}/file`} target="_blank" rel="noreferrer">
            Open original
          </a>
        </div>
        <div className="drawing-stage">
          {mimeType === "application/pdf" ? (
            <iframe className="drawing-frame" src={`/api/drawings/${drawingId}/file#toolbar=0&navpanes=0`} title={`Drawing preview: ${fileName}`} />
          ) : mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="drawing-image" src={`/api/drawings/${drawingId}/file`} alt={`Drawing preview: ${fileName}`} />
          ) : (
            <div className="cad-preview-placeholder">
              <strong>CAD drawing attached</strong>
              <span>{fileName}</span>
              <p>Browser preview is not available for this CAD format. Extraction results remain reviewable on the right.</p>
              <a className="btn" href={`/api/drawings/${drawingId}/file`} target="_blank" rel="noreferrer">Open / download original</a>
            </div>
          )}
        </div>
      </aside>

      <form action={acceptReviewedExtraction} className="review-panel">
        <input type="hidden" name="rfqId" value={rfqId} />
        <input type="hidden" name="drawingId" value={drawingId} />
        {nextPath && <input type="hidden" name="nextPath" value={nextPath} />}

        <div className="review-summary">
          <div>
            <span className="eyebrow">AI extraction review</span>
            <h3>Verify engineering data before costing</h3>
            <p>Correct any field that does not match the controlled drawing. Your approved values become the source for the quotation.</p>
          </div>
          <div className="review-score" aria-label={`Average extraction confidence ${confidenceSummary}%`}>
            <strong>{confidenceSummary}%</strong>
            <span>avg. confidence</span>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="review-warning" role="status">
            <strong>{warnings.length} extraction {warnings.length === 1 ? "warning" : "warnings"}</strong>
            <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </div>
        )}

        <section className="review-section">
          <div className="review-section-title">
            <span>01</span>
            <div><strong>Drawing identity</strong><small>Revision-controlled identification</small></div>
          </div>
          <div className="review-fields">
            {renderField("Drawing number", "drawingNumber", "drawing_number")}
            {renderField("Revision", "revision", "revision")}
            <div className="review-field review-field-wide">
              <div className="review-field-head"><label htmlFor="review-description">Part / drawing description</label><Confidence item={field(extracted, "description")} /></div>
              <input className="input" id="review-description" name="description" required value={values.description} onChange={set("description")} />
              <div className="review-evidence"><span>Drawing</span><span className="review-evidence-text">{field(extracted, "description").evidence || "No direct evidence captured"}</span></div>
            </div>
          </div>
        </section>

        <section className="review-section">
          <div className="review-section-title">
            <span>02</span>
            <div><strong>Material & quantity</strong><small>Commercial quantity and material basis</small></div>
          </div>
          <div className="review-fields">
            {renderField("Material / grade", "material", "material", { required: false })}
            {renderField("Quantity", "quantity", "quantity", { type: "number", required: true, step: "0.001" })}
          </div>
        </section>

        <section className="review-section">
          <div className="review-section-title">
            <span>03</span>
            <div><strong>Overall geometry</strong><small>All dimensional values are stored in millimetres</small></div>
          </div>
          <div className="review-fields review-fields-3">
            {renderField("Length", "lengthMm", "length_mm", { unit: "mm", type: "number", step: "0.001" })}
            {renderField("Width", "widthMm", "width_mm", { unit: "mm", type: "number", step: "0.001" })}
            {renderField("Thickness", "thicknessMm", "thickness_mm", { unit: "mm", type: "number", step: "0.001" })}
            {renderField("Diameter", "diameterMm", "diameter_mm", { unit: "mm", type: "number", step: "0.001" })}
          </div>
        </section>

        <section className="review-section">
          <div className="review-section-title">
            <span>04</span>
            <div><strong>Manufacturing requirements</strong><small>Additional notes extracted from drawing callouts and specifications</small></div>
          </div>
          <div className="review-fields">
            {renderField("General tolerance", "tolerance", "tolerance")}
            {renderField("Surface finish", "surfaceFinish", "surface_finish")}
            {renderField("Weld details", "weldDetails", "weld_details")}
            {renderField("Hole / thread details", "holeThreadDetails", "hole_thread_details")}
            {renderField("Heat treatment", "heatTreatment", "heat_treatment")}
            {renderField("Coating / plating", "coating", "coating")}
          </div>
        </section>

        <section className="review-section weight-review-section">
          <div className="review-section-title">
            <span>05</span>
            <div><strong>Weight validation</strong><small>Drawing value first; geometry calculation only when required</small></div>
          </div>
          <div className="review-fields">
            {renderField("Drawing stated weight", "drawingWeightKg", "drawing_weight_kg", { unit: "kg", type: "number", step: "0.001" })}
            <div className="review-field">
              <div className="review-field-head"><label htmlFor="review-scrapPercent">Raw material scrap allowance</label></div>
              <div className="review-input-wrap">
                <input className="input" id="review-scrapPercent" name="scrapPercent" type="number" min="0" max="100" step="0.1" value={values.scrapPercent} onChange={set("scrapPercent")} />
                <span className="review-unit">%</span>
              </div>
              <div className="review-evidence"><span>Estimator</span><span className="review-evidence-text">Applied only to raw purchase weight</span></div>
            </div>
          </div>
          <div className="weight-result-grid">
            <div><span>Weight source</span><strong>{calculatedWeight.source}</strong></div>
            <div><span>Net / finished weight</span><strong>{calculatedWeight.net === null ? "—" : `${calculatedWeight.net.toFixed(3)} kg`}</strong></div>
            <div><span>Raw purchase weight</span><strong>{calculatedWeight.raw === null ? "—" : `${calculatedWeight.raw.toFixed(3)} kg`}</strong></div>
          </div>
          <p className="weight-note">{calculatedWeight.note}</p>
        </section>

        <div className="review-footer">
          <div>
            <strong>Approval creates a reviewed part</strong>
            <span>AI values remain editable until you approve. Existing rates, costing and quotation logic remain unchanged.</span>
          </div>
          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
