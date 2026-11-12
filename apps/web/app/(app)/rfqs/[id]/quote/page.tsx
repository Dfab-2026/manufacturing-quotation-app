import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/security/auth";
import { AutoSaveForm } from "@/components/auto-save-form";
import { addManualCostLine, deleteCostLine, deleteProcessRoute, updateCostLine, updatePartQuoteFields, updateProcessRoute, updateQuoteCommercials, updateQuoteHeader } from "../actions";

type Props = { params: Promise<{ id: string }> };

const money = (value: number, currency: string) => value.toLocaleString("en-IN", { style: "currency", currency, maximumFractionDigits: 2 });
const categories = ["material", "process", "labor", "consumable", "subcontract", "inspection", "packing", "other"] as const;
const bases = ["kg", "minute", "hour", "mm", "meter", "bend", "piece", "sqm", "lot"] as const;

export default async function QuotePage({ params }: Props) {
  const { id } = await params;
  const { supabase, membership } = await requireSession();
  const [{ data: rfq }, { data: parts }, { data: costs }, { data: routes }] = await Promise.all([
    supabase.from("rfqs").select("id,quote_number,title,status,currency,total_value,direct_cost,overhead_percent,margin_percent,tax_percent,freight_amount,validity_days,customer_reference,required_date,notes,customers(name,email,phone,gstin)").eq("tenant_id", membership.tenant_id).eq("id", id).maybeSingle(),
    supabase.from("parts").select("id,drawing_number,revision,description,quantity,material_code,net_weight_kg,raw_weight_kg").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at"),
    supabase.from("cost_lines").select("id,part_id,category,description,quantity,basis,rate,waste_percent,amount").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at"),
    supabase.from("process_routes").select("id,part_id,sequence_no,operation,work_center,setup_minutes,cycle_minutes,quantity,source,confidence,notes").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("part_id").order("sequence_no")
  ]);
  if (!rfq) notFound();
  const customer = rfq.customers as unknown as { name?: string; email?: string; phone?: string; gstin?: string } | null;
  const subtotal = Number(rfq.total_value ?? 0);
  const freight = Number(rfq.freight_amount ?? 0);
  const tax = (subtotal + freight) * Number(rfq.tax_percent ?? 0) / 100;
  const grandTotal = subtotal + freight + tax;
  const missingRates = (costs ?? []).filter((line) => !Number.isFinite(Number(line.rate)) || Number(line.rate) <= 0);

  return (
    <>
      <div className="page-head">
        <div><span className="eyebrow">Step 3 of 3</span><h1>Build quotation</h1><p>{rfq.quote_number ?? String(rfq.id).slice(0, 8).toUpperCase()} · Every commercial value below is editable.</p></div>
        <div className="actions"><Link className="btn" href={`/rfqs/${id}/review`}>← Analyzed data</Link><a className="btn btn-primary" href={`/api/rfqs/${id}/quote.pdf`}>Download quotation PDF</a></div>
      </div>
      <div className="flow-progress" aria-label="Quotation progress"><div className="flow-progress-item done"><span>✓</span><strong>Upload & analyze</strong></div><div className="flow-progress-line done"/><div className="flow-progress-item done"><span>✓</span><strong>Analyzed data</strong></div><div className="flow-progress-line done"/><div className="flow-progress-item active"><span>3</span><strong>Quotation</strong></div></div>

      {missingRates.length > 0 && (
        <section className="card" aria-label="Attention: missing quotation rates" style={{ marginBottom: 16 }}>
          <div className="card-head"><h2>Attention · {missingRates.length} missing rate{missingRates.length > 1 ? "s" : ""}</h2></div>
          <div className="card-body stack">
            {missingRates.map((line) => (
              <div className="summary-row" key={line.id}>
                <span>{line.description} — rate not entered</span>
                <a className="btn btn-sm" href={`#cost-line-${line.id}`}>Go to rate</a>
              </div>
            ))}
            <p className="help">Enter a positive rate. Changes save automatically; this notice disappears after the updated rate is stored.</p>
          </div>
        </section>
      )}
      <div className="quote-layout">
        <div className="stack">
          <section className="card">
            <div className="card-head"><div><h2>Quotation header</h2><span className="help">Customer and enquiry information</span></div><span className="badge badge-ready">Editable</span></div>
            <form action={updateQuoteHeader} className="card-body form-grid">
              <input type="hidden" name="rfqId" value={id}/>
              <div className="field"><label>Quotation title</label><input className="input" name="title" defaultValue={rfq.title} required/></div>
              <div className="field"><label>Customer</label><div className="read-only-box"><strong>{customer?.name ?? "Unassigned"}</strong><span>{customer?.email ?? customer?.phone ?? "Customer can be assigned from the customer master"}</span></div></div>
              <div className="field field-4"><label>Customer RFQ reference</label><input className="input" name="customerReference" defaultValue={rfq.customer_reference ?? ""}/></div>
              <div className="field field-4"><label>Required date</label><input className="input" type="date" name="requiredDate" defaultValue={rfq.required_date ?? ""}/></div>
              <div className="field field-4"><label>Currency</label><select className="select" name="currency" defaultValue={rfq.currency}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></div>
              <div className="field field-full"><label>Quotation / internal notes</label><textarea className="textarea" name="notes" defaultValue={rfq.notes ?? ""}/></div>
              <div className="field field-full"><button className="btn" type="submit">Save quotation details</button></div>
            </form>
          </section>

          <section className="card">
            <div className="card-head"><div><h2>Quotation items</h2><span className="help">Edit the customer-facing drawing number, revision, description and quantity.</span></div></div>
            {(parts ?? []).length ? <div className="quote-item-list">{(parts ?? []).map((part) => <form action={updatePartQuoteFields} className="quote-item-edit" key={part.id}><input type="hidden" name="rfqId" value={id}/><input type="hidden" name="partId" value={part.id}/><div className="field"><label>Drawing no.</label><input className="input" name="drawingNumber" defaultValue={part.drawing_number ?? ""}/></div><div className="field"><label>Revision</label><input className="input" name="revision" defaultValue={part.revision ?? ""}/></div><div className="field quote-item-description"><label>Description</label><input className="input" name="description" defaultValue={part.description} required/></div><div className="field"><label>Qty</label><input className="input" name="quantity" type="number" min="0.001" step="0.001" defaultValue={Number(part.quantity)} required/></div><div className="quote-item-meta"><span>{part.material_code || "No material"}</span><span>Net {part.net_weight_kg ? `${Number(part.net_weight_kg).toFixed(3)} kg` : "—"}</span><span>Raw {part.raw_weight_kg ? `${Number(part.raw_weight_kg).toFixed(3)} kg` : "—"}</span></div><button className="btn btn-sm" type="submit">Save item</button></form>)}</div> : <div className="empty"><strong>No reviewed items</strong>Review the drawing extraction before building the quotation.</div>}
          </section>

          <section className="card">
            <div className="card-head"><div><h2>Manufacturing process</h2><span className="help">AI-suggested operations are carried forward from the analyzed drawing. Edit them before pricing.</span></div><span className="badge badge-ready">Editable</span></div>
            {(routes ?? []).length ? (
              <div className="quote-cost-list">
                {(routes ?? []).map((route) => {
                  const part = (parts ?? []).find((item) => item.id === route.part_id);
                  return (
                    <form action={updateProcessRoute} className="quote-cost-edit" key={route.id}>
                      <input type="hidden" name="rfqId" value={id} />
                      <input type="hidden" name="routeId" value={route.id} />
                      <input type="hidden" name="partId" value={route.part_id} />
                      <div className="field"><label>Seq.</label><div className="read-only-box"><strong>{Number(route.sequence_no)}</strong><span>{part?.drawing_number || part?.description || "Part"}</span></div></div>
                      <div className="field quote-line-description"><label>Operation</label><input className="input" name="operation" defaultValue={route.operation} required /></div>
                      <div className="field"><label>Work center</label><input className="input" name="workCenter" defaultValue={route.work_center ?? ""} /></div>
                      <div className="field"><label>Setup min</label><input className="input" name="setupMinutes" type="number" min="0" step="0.01" defaultValue={Number(route.setup_minutes)} /></div>
                      <div className="field"><label>Cycle min / pc</label><input className="input" name="cycleMinutes" type="number" min="0" step="0.01" defaultValue={Number(route.cycle_minutes)} /></div>
                      <div className="field"><label>Qty</label><input className="input" name="quantity" type="number" min="0.001" step="0.001" defaultValue={Number(route.quantity)} /></div>
                      <div className="quote-line-amount"><span>Source</span><strong>{route.source === "inferred" ? "AI" : route.source}</strong></div>
                      <button className="btn btn-sm" type="submit">Save</button>
                      <button className="btn btn-sm btn-danger" type="submit" formAction={deleteProcessRoute}>Delete</button>
                    </form>
                  );
                })}
              </div>
            ) : (
              <div className="empty"><strong>No manufacturing route saved</strong>The quotation can still be priced manually using cost lines.</div>
            )}
          </section>

          <section className="card">
            <div className="card-head"><div><h2>Cost & price lines</h2><span className="help">Material, machine, labour, subcontract, inspection, packing and other charges.</span></div></div>
            {(costs ?? []).length > 0 && <div className="quote-cost-list">{(costs ?? []).map((cost) => <AutoSaveForm action={updateCostLine} className="quote-cost-edit" key={cost.id} id={`cost-line-${cost.id}`} style={{ scrollMarginTop: 100 }}><input type="hidden" name="rfqId" value={id}/><input type="hidden" name="lineId" value={cost.id}/><div className="field"><label>Part</label><select className="select" name="partId" defaultValue={cost.part_id ?? ""}><option value="">Quotation level</option>{(parts ?? []).map((part) => <option key={part.id} value={part.id}>{part.drawing_number || part.description}</option>)}</select></div><div className="field"><label>Category</label><select className="select" name="category" defaultValue={cost.category}>{categories.map((value) => <option key={value}>{value}</option>)}</select></div><div className="field quote-line-description"><label>Description</label><input className="input" name="description" defaultValue={cost.description} required/></div><div className="field"><label>Qty</label><input className="input" type="number" name="quantity" min="0" step="0.001" defaultValue={Number(cost.quantity)} required/></div><div className="field"><label>Basis</label><select className="select" name="basis" defaultValue={cost.basis}>{bases.map((value) => <option key={value}>{value}</option>)}</select></div><div className="field"><label>Rate</label><input className="input" type="number" name="rate" min="0" step="0.01" defaultValue={Number(cost.rate)} required/></div><div className="field"><label>Waste %</label><input className="input" type="number" name="wastePercent" min="0" max="100" step="0.01" defaultValue={Number(cost.waste_percent)} /></div><div className="quote-line-amount"><span>Amount</span><strong>{money(Number(cost.amount), rfq.currency)}</strong></div><button className="btn btn-sm" type="submit">Save</button><button className="btn btn-sm btn-danger" type="submit" formAction={deleteCostLine}>Delete</button></AutoSaveForm>)}</div>}

            <form action={addManualCostLine} className="card-body quote-add-line">
              <input type="hidden" name="rfqId" value={id}/><div className="field"><label>Part</label><select className="select" name="partId"><option value="">Quotation level</option>{(parts ?? []).map((part) => <option key={part.id} value={part.id}>{part.drawing_number || part.description}</option>)}</select></div><div className="field"><label>Category</label><select className="select" name="category" defaultValue="process">{categories.map((value) => <option key={value}>{value}</option>)}</select></div><div className="field quote-line-description"><label>Description</label><input className="input" name="description" placeholder="e.g. Laser cutting" required/></div><div className="field"><label>Qty</label><input className="input" name="quantity" type="number" min="0" step="0.001" defaultValue="1" required/></div><div className="field"><label>Basis</label><select className="select" name="basis" defaultValue="piece">{bases.map((value) => <option key={value}>{value}</option>)}</select></div><div className="field"><label>Rate</label><input className="input" name="rate" type="number" min="0" step="0.01" required/></div><div className="field"><label>Waste %</label><input className="input" name="wastePercent" type="number" min="0" max="100" step="0.01" defaultValue="0"/></div><div className="field"><label>&nbsp;</label><button className="btn btn-primary" type="submit">＋ Add line</button></div>
            </form>
          </section>
        </div>

        <aside className="stack quote-sidebar">
          <section className="card quote-summary-card">
            <div className="card-head"><h2>Commercial summary</h2></div>
            <AutoSaveForm action={updateQuoteCommercials} className="card-body stack">
              <input type="hidden" name="rfqId" value={id}/>
              <div className="summary-row"><span>Direct cost</span><strong>{money(Number(rfq.direct_cost ?? 0), rfq.currency)}</strong></div>
              <div className="form-grid compact-grid"><div className="field"><label>Overhead %</label><input className="input" name="overheadPercent" type="number" min="0" max="100" step="0.01" defaultValue={Number(rfq.overhead_percent)}/></div><div className="field"><label>Margin %</label><input className="input" name="marginPercent" type="number" min="0" max="99.99" step="0.01" defaultValue={Number(rfq.margin_percent)}/></div><div className="field"><label>Tax %</label><input className="input" name="taxPercent" type="number" min="0" max="100" step="0.01" defaultValue={Number(rfq.tax_percent)}/></div><div className="field"><label>Freight</label><input className="input" name="freightAmount" type="number" min="0" step="0.01" defaultValue={Number(rfq.freight_amount)}/></div><div className="field field-full"><label>Validity days</label><input className="input" name="validityDays" type="number" min="1" max="3650" defaultValue={Number(rfq.validity_days)}/></div></div>
              <p className="help">Changes save and recalculate automatically. You can also save manually.</p><button className="btn" type="submit">Recalculate & save</button>
            </AutoSaveForm>
            <div className="quote-totals"><div><span>Selling subtotal</span><strong>{money(subtotal, rfq.currency)}</strong></div><div><span>Freight</span><strong>{money(freight, rfq.currency)}</strong></div><div><span>Tax</span><strong>{money(tax, rfq.currency)}</strong></div><div className="grand-total"><span>Grand total</span><strong>{money(grandTotal, rfq.currency)}</strong></div></div>
            <div className="quote-download"><a className="btn btn-primary" href={`/api/rfqs/${id}/quote.pdf`}>Download PDF quotation</a></div>
          </section>
        </aside>
      </div>
    </>
  );
}
