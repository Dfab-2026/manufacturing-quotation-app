import { requireSession } from "@/lib/security/auth";
import { createRate, updateRate } from "./actions";
import { AutoSaveForm } from "@/components/auto-save-form";

export default async function RatesPage() {
  const { supabase, membership } = await requireSession();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const { data } = await supabase.from("master_rates").select("id,name,category,basis,rate,currency,material_code,active").eq("tenant_id", membership.tenant_id).order("category").order("name");
  return <>
    <div className="page-head"><div><h1>Master rates</h1><p>Company-owned rates used by the deterministic costing engine. Existing rates save automatically when edited.</p></div></div>
    <div className="grid-2">
      <section className="card"><div className="card-head"><h2>Rate library</h2></div>{(data??[]).length ? <div className="table-wrap"><table><thead><tr><th>Rate</th><th>Category</th><th>Basis</th><th>Amount</th></tr></thead><tbody>{(data??[]).map(r=><tr key={r.id}><td><strong>{r.name}</strong><div className="help">{r.material_code || "General"}</div></td><td>{r.category}</td><td>per {r.basis}</td><td>{canEdit ? <AutoSaveForm action={updateRate} className="inline-form" aria-label={`Edit ${r.name} rate`}>
        <input type="hidden" name="id" value={r.id}/>
        <input className="input input-compact" type="number" name="rate" min="0" step="0.01" defaultValue={Number(r.rate)} required aria-label={`Rate for ${r.name}`}/>
        <span className="help">{r.currency} · Auto-saves</span>
      </AutoSaveForm> : Number(r.rate).toLocaleString("en-IN", { style: "currency", currency: r.currency })}</td></tr>)}</tbody></table></div> : <div className="empty"><strong>No master rates</strong>Add controlled material and process rates before commercial costing.</div>}</section>
      <section className="card"><div className="card-head"><h2>Add rate</h2></div><form action={createRate} className="card-body form-grid">
        <div className="field field-full"><label htmlFor="name">Rate name *</label><input className="input" id="name" name="name" required placeholder="TIG welding"/></div>
        <div className="field"><label htmlFor="category">Category</label><select className="select" id="category" name="category"><option>material</option><option>process</option><option>labor</option><option>consumable</option><option>subcontract</option><option>inspection</option><option>packing</option><option>other</option></select></div>
        <div className="field"><label htmlFor="basis">Rate basis</label><select className="select" id="basis" name="basis"><option>kg</option><option>minute</option><option>hour</option><option>mm</option><option>meter</option><option>bend</option><option>piece</option><option>sqm</option><option>lot</option></select></div>
        <div className="field"><label htmlFor="rate">Rate *</label><input className="input" id="rate" name="rate" type="number" min="0" step="0.01" required/></div>
        <div className="field"><label htmlFor="currency">Currency</label><select className="select" id="currency" name="currency"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></div>
        <div className="field field-full"><label htmlFor="materialCode">Material code (optional)</label><input className="input" id="materialCode" name="materialCode" placeholder="SS304"/></div>
        <div className="field field-full"><button className="btn btn-primary" type="submit">Save master rate</button></div>
      </form></section>
    </div>
  </>;
}
