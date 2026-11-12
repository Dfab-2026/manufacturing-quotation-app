import { notFound } from "next/navigation";
import { DrawingUpload } from "@/components/drawing-upload";
import { ExtractionReview } from "@/components/extraction-review";
import { requireSession } from "@/lib/security/auth";
import { updateRfqStatus } from "../actions";
import {
  addCostLine,
  addProcessRoute,
  updateCommercials,
  requestApproval,
  saveQuoteVersion,
  generateQuantityBreaks
} from "./actions";

type Props = {
  params: Promise<{ id: string }>;
};

const money = (value: number, currency: string) =>
  value.toLocaleString("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  });

export default async function RfqDetailPage({ params }: Props) {
  const { id } = await params;
  const { supabase, membership } = await requireSession();

  const { data: rfq } = await supabase
    .from("rfqs")
    .select(
      "id,quote_number,title,status,currency,total_value,direct_cost,overhead_percent,margin_percent,customer_reference,required_date,notes,customers(name)"
    )
    .eq("tenant_id", membership.tenant_id)
    .eq("id", id)
    .maybeSingle();

  if (!rfq) notFound();

  const [
    { data: drawings },
    { data: jobs },
    { data: extractions },
    { data: parts },
    { data: rates },
    { data: costs },
    { data: routes },
    { data: quantityBreaks },
    { data: versions }
  ] = await Promise.all([
    supabase
      .from("drawings")
      .select("id,file_name,mime_type,size_bytes,created_at,extraction_status")
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("analysis_jobs")
      .select("id,drawing_id,status,error_message,created_at")
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("drawing_extractions")
      .select("id,drawing_id,structured_data,warnings,created_at")
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("parts")
      .select(
        "id,drawing_id,drawing_number,revision,description,quantity,material_code,length_mm,width_mm,thickness_mm,drawing_weight_kg,net_weight_kg,raw_weight_kg,weight_source"
      )
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("created_at"),
    supabase
      .from("master_rates")
      .select("id,name,category,basis,rate,currency")
      .eq("tenant_id", membership.tenant_id)
      .eq("active", true)
      .order("category")
      .order("name"),
    supabase
      .from("cost_lines")
      .select("id,part_id,category,description,quantity,basis,rate,waste_percent,amount")
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("created_at"),
    supabase
      .from("process_routes")
      .select("id,part_id,sequence_no,operation,work_center,setup_minutes,cycle_minutes,quantity,rate_id,source")
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("part_id")
      .order("sequence_no"),
    supabase
      .from("quantity_breaks")
      .select("id,part_id,quantity,unit_price,total_price")
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("quantity"),
    supabase
      .from("quote_versions")
      .select("id,version_no,total_value,created_at")
      .eq("tenant_id", membership.tenant_id)
      .eq("rfq_id", id)
      .order("version_no", { ascending: false })
  ]);

  const customer = rfq.customers as unknown as { name?: string } | null;
  const latest = extractions?.[0] ?? null;
  const extracted = (latest?.structured_data ?? {}) as Record<string, {
    value?: string | number | null;
    confidence?: number;
    evidence?: string | null;
    source?: string | null;
  }>;
  const reviewedDrawingIds = new Set((parts ?? []).map((part) => part.drawing_id));
  const canAcceptLatest = Boolean(latest && !reviewedDrawingIds.has(latest.drawing_id));
  const latestDrawing = latest
    ? (drawings ?? []).find((drawing) => drawing.id === latest.drawing_id) ?? null
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{rfq.title}</h1>
          <p>
            {rfq.quote_number ?? String(rfq.id).slice(0, 8).toUpperCase()}
            {" · "}
            {customer?.name ?? "Unassigned customer"}
          </p>
        </div>
        <div className="actions">
          <form action={updateRfqStatus.bind(null, id, "review")}>
            <button className="btn" type="submit">Move to review</button>
          </form>
          <a className="btn" href={`/api/rfqs/${id}/quote.pdf`}>Download PDF</a>
          <form action={updateRfqStatus.bind(null, id, "ready")}>
            <button className="btn btn-primary" type="submit">Mark ready</button>
          </form>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Drawing package</h2>
              <span
                className={`badge badge-${
                  rfq.status === "ready"
                    ? "ready"
                    : rfq.status === "review"
                      ? "review"
                      : "draft"
                }`}
              >
                {rfq.status}
              </span>
            </div>
            <div className="card-body">
              <DrawingUpload rfqId={id} />
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Uploaded drawings</h2></div>
            {(drawings ?? []).length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>File</th><th>Analysis</th><th>Size</th></tr>
                  </thead>
                  <tbody>
                    {(drawings ?? []).map((drawing) => (
                      <tr key={drawing.id}>
                        <td>
                          <strong>{drawing.file_name}</strong>
                          <div className="help">{drawing.mime_type}</div>
                        </td>
                        <td>
                          <span
                            className={`badge badge-${
                              drawing.extraction_status === "completed"
                                ? "ready"
                                : drawing.extraction_status === "failed"
                                  ? "review"
                                  : "draft"
                            }`}
                          >
                            {drawing.extraction_status}
                          </span>
                        </td>
                        <td>
                          {(Number(drawing.size_bytes) / 1024 / 1024).toFixed(2)} MB
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <strong>No drawings uploaded</strong>
                Upload the controlled drawing package to begin extraction.
              </div>
            )}
          </section>

          <section className="card review-card">
            <div className="card-head">
              <div>
                <h2>Drawing analysis & review</h2>
                <span className="help">Controlled engineering verification before costing</span>
              </div>
              {latest && <span className="badge badge-ready">Analysis complete</span>}
            </div>
            {latest && latestDrawing && canAcceptLatest ? (
              <ExtractionReview
                rfqId={id}
                drawingId={latest.drawing_id}
                fileName={latestDrawing.file_name}
                mimeType={latestDrawing.mime_type}
                extracted={extracted}
                warnings={(latest.warnings as string[] | null) ?? []}
              />
            ) : latest && latestDrawing ? (
              <div className="review-approved">
                <div className="review-approved-icon">✓</div>
                <div>
                  <strong>Drawing review approved</strong>
                  <p>The latest extraction is already stored as a reviewed part. Continue with routing and costing.</p>
                </div>
                <a className="btn btn-sm" href={`/api/drawings/${latest.drawing_id}/file`} target="_blank" rel="noreferrer">Open drawing</a>
              </div>
            ) : (
              <div className="empty">
                <strong>No extraction result yet</strong>
                The analysis worker will place evidence-backed drawing values here when processing completes.
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Commercial summary</h2></div>
            <div className="card-body form-grid">
              <div className="field">
                <label>Customer reference</label>
                <div>{rfq.customer_reference || "—"}</div>
              </div>
              <div className="field">
                <label>Required date</label>
                <div>
                  {rfq.required_date
                    ? new Date(rfq.required_date).toLocaleDateString("en-IN")
                    : "—"}
                </div>
              </div>
              <div className="field">
                <label>Direct cost</label>
                <div>{money(Number(rfq.direct_cost ?? 0), rfq.currency)}</div>
              </div>
              <div className="field">
                <label>Quote total</label>
                <div><strong>{money(Number(rfq.total_value ?? 0), rfq.currency)}</strong></div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Reviewed parts & weight</h2></div>
            {(parts ?? []).length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Part</th><th>Material</th><th>Dimensions</th><th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(parts ?? []).map((part) => (
                      <tr key={part.id}>
                        <td>
                          <strong>{part.drawing_number || part.description}</strong>
                          <div className="help">Rev {part.revision || "—"}</div>
                        </td>
                        <td>{part.material_code || "—"}</td>
                        <td>
                          {[part.length_mm, part.width_mm, part.thickness_mm]
                            .filter(Boolean)
                            .join(" × ") || "—"}
                        </td>
                        <td>
                          {part.net_weight_kg
                            ? `${Number(part.net_weight_kg).toFixed(3)} kg`
                            : "—"}
                          <div className="help">
                            Raw {part.raw_weight_kg
                              ? `${Number(part.raw_weight_kg).toFixed(3)} kg`
                              : "—"}
                            {part.weight_source ? ` · ${part.weight_source}` : ""}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <strong>No reviewed parts</strong>
                Accept a completed extraction before commercial costing.
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head"><h2>Manufacturing route</h2></div>
            {(routes ?? []).length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Seq</th><th>Operation</th><th>Work center</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {(routes ?? []).map((route) => (
                      <tr key={route.id}>
                        <td>{route.sequence_no}</td>
                        <td><strong>{route.operation}</strong><div className="help">{route.source}</div></td>
                        <td>{route.work_center || "—"}</td>
                        <td>{Number(route.setup_minutes)} min setup + {Number(route.cycle_minutes)} min × {Number(route.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <form action={addProcessRoute} className="card-body form-grid">
              <input type="hidden" name="rfqId" value={id} />
              <div className="field field-full">
                <label htmlFor="routePartId">Part</label>
                <select className="select" id="routePartId" name="partId" required>
                  <option value="">Select reviewed part</option>
                  {(parts ?? []).map((part) => (
                    <option key={part.id} value={part.id}>{part.drawing_number || part.description}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="operation">Operation</label>
                <input className="input" id="operation" name="operation" required placeholder="Laser cutting" />
              </div>
              <div className="field">
                <label htmlFor="workCenter">Work center</label>
                <input className="input" id="workCenter" name="workCenter" placeholder="Laser-01" />
              </div>
              <div className="field field-4">
                <label htmlFor="setupMinutes">Setup min</label>
                <input className="input" id="setupMinutes" name="setupMinutes" type="number" min="0" step="0.01" defaultValue="0" />
              </div>
              <div className="field field-4">
                <label htmlFor="cycleMinutes">Cycle min / pc</label>
                <input className="input" id="cycleMinutes" name="cycleMinutes" type="number" min="0" step="0.01" defaultValue="0" />
              </div>
              <div className="field field-4">
                <label htmlFor="routeQuantity">Qty</label>
                <input className="input" id="routeQuantity" name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" />
              </div>
              <div className="field field-full">
                <label htmlFor="routeRateId">Rate (optional, auto-adds route cost)</label>
                <select className="select" id="routeRateId" name="rateId">
                  <option value="">No linked cost rate</option>
                  {(rates ?? []).filter((rate) => rate.category !== "material").map((rate) => (
                    <option key={rate.id} value={rate.id}>
                      {rate.name} · {money(Number(rate.rate), rate.currency)} / {rate.basis}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field field-full"><button className="btn" type="submit">Add process operation</button></div>
            </form>
          </section>

          <section className="card">
            <div className="card-head"><h2>Cost build-up</h2></div>
            {(costs ?? []).length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Cost</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
                  </thead>
                  <tbody>
                    {(costs ?? []).map((cost) => (
                      <tr key={cost.id}>
                        <td>
                          <strong>{cost.description}</strong>
                          <div className="help">{cost.category}</div>
                        </td>
                        <td>{Number(cost.quantity)} {cost.basis}</td>
                        <td>{money(Number(cost.rate), rfq.currency)}</td>
                        <td>{money(Number(cost.amount), rfq.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <form action={addCostLine} className="card-body form-grid">
              <input type="hidden" name="rfqId" value={id} />
              <div className="field field-full">
                <label htmlFor="partId">Part</label>
                <select className="select" id="partId" name="partId">
                  <option value="">RFQ-level cost</option>
                  {(parts ?? []).map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.drawing_number || part.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field field-full">
                <label htmlFor="rateId">Master rate</label>
                <select className="select" id="rateId" name="rateId" required>
                  <option value="">Select controlled rate</option>
                  {(rates ?? []).map((rate) => (
                    <option key={rate.id} value={rate.id}>
                      {rate.name} · {money(Number(rate.rate), rate.currency)} / {rate.basis}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="quantity">Charge quantity</label>
                <input
                  className="input"
                  id="quantity"
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="wastePercent">Waste / allowance %</label>
                <input
                  className="input"
                  id="wastePercent"
                  name="wastePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue="0"
                />
              </div>
              <div className="field field-full">
                <button className="btn" type="submit">Add cost line</button>
              </div>
            </form>
          </section>

          <section className="card">
            <div className="card-head"><h2>Commercial controls</h2></div>
            <form action={updateCommercials} className="card-body form-grid">
              <input type="hidden" name="rfqId" value={id} />
              <div className="field">
                <label htmlFor="overheadPercent">Overhead %</label>
                <input
                  className="input"
                  id="overheadPercent"
                  name="overheadPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={Number(rfq.overhead_percent)}
                />
              </div>
              <div className="field">
                <label htmlFor="marginPercent">Margin %</label>
                <input
                  className="input"
                  id="marginPercent"
                  name="marginPercent"
                  type="number"
                  min="0"
                  max="99.99"
                  step="0.01"
                  defaultValue={Number(rfq.margin_percent)}
                />
              </div>
              <div className="field field-full">
                <button className="btn btn-primary" type="submit">
                  Recalculate quotation
                </button>
              </div>
            </form>
          </section>


          <section className="card">
            <div className="card-head"><h2>Quantity pricing</h2><span className="help">Setup costs are diluted across larger batch quantities</span></div>
            {(quantityBreaks ?? []).length ? <div className="table-wrap"><table><thead><tr><th>Part</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{(quantityBreaks ?? []).map((q) => <tr key={q.id}><td>{String(q.part_id).slice(0,8)}</td><td>{Number(q.quantity)}</td><td>{money(Number(q.unit_price), rfq.currency)}</td><td>{money(Number(q.total_price), rfq.currency)}</td></tr>)}</tbody></table></div> : null}
            <form action={generateQuantityBreaks} className="card-body form-grid">
              <input type="hidden" name="rfqId" value={id}/><div className="field"><label>Part</label><select className="select" name="partId" required><option value="">Select part</option>{(parts ?? []).map((p)=><option key={p.id} value={p.id}>{p.drawing_number || p.description}</option>)}</select></div><div className="field"><label>Quantities</label><input className="input" name="quantities" defaultValue="1,10,25,50,100" required/></div><div className="field field-full"><button className="btn" type="submit">Generate quantity prices</button></div>
            </form>
          </section>

          <section className="card">
            <div className="card-head"><h2>Approval & revisions</h2><span className="help">Freeze commercial snapshots before sending</span></div>
            <div className="card-body">
              <div className="actions"><form action={requestApproval}><input type="hidden" name="rfqId" value={id}/><input type="hidden" name="reason" value="Commercial quotation approval"/><button className="btn" type="submit">Request approval</button></form><form action={saveQuoteVersion}><input type="hidden" name="rfqId" value={id}/><button className="btn btn-primary" type="submit">Save quotation revision</button></form></div>
              <div className="help" style={{marginTop:10}}>Saved revisions: {(versions ?? []).length}{versions?.[0] ? ` · Latest Rev ${versions[0].version_no}` : ""}</div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Analysis queue</h2></div>
            {(jobs ?? []).length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Job</th><th>Status</th><th>Result</th></tr></thead>
                  <tbody>
                    {(jobs ?? []).map((job) => (
                      <tr key={job.id}>
                        <td>{String(job.id).slice(0, 8)}</td>
                        <td>{job.status}</td>
                        <td>{job.error_message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <strong>No analysis jobs</strong>
                Jobs appear automatically after drawing upload.
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
