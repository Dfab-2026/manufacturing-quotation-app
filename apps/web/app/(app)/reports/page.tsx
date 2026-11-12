import { requireSession } from "@/lib/security/auth";
const money=(v:number)=>v.toLocaleString("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0});
export default async function ReportsPage(){
 const {supabase,membership}=await requireSession(); const t=membership.tenant_id;
 const [{data:rfqs},{data:actuals},{data:customers}]=await Promise.all([
  supabase.from("rfqs").select("id,status,total_value,direct_cost,margin_percent,customer_id,created_at").eq("tenant_id",t),
  supabase.from("actual_job_costs").select("rfq_id,material_cost,labor_cost,machine_cost,subcontract_cost,scrap_cost,other_cost").eq("tenant_id",t),
  supabase.from("customers").select("id,name").eq("tenant_id",t)
 ]);
 const rows=rfqs??[]; const total=rows.reduce((s,r)=>s+Number(r.total_value??0),0); const won=rows.filter(r=>r.status==="won"); const sent=rows.filter(r=>["sent","won","lost"].includes(r.status));
 const actualMap=new Map((actuals??[]).map(a=>[a.rfq_id,[a.material_cost,a.labor_cost,a.machine_cost,a.subcontract_cost,a.scrap_cost,a.other_cost].reduce((s,v)=>s+Number(v??0),0)]));
 const variance=rows.reduce((s,r)=>s+((actualMap.get(r.id)??0)-Number(r.direct_cost??0)),0);
 const custMap=new Map((customers??[]).map(c=>[c.id,c.name])); const byCustomer=new Map<string,number>(); rows.forEach(r=>{const n=custMap.get(r.customer_id)||"Unassigned";byCustomer.set(n,(byCustomer.get(n)||0)+Number(r.total_value||0));});
 return <><div className="page-head"><div><h1>Commercial reports</h1><p>Quotation value, conversion and quoted-vs-actual manufacturing performance.</p></div></div><div className="grid-4"><div className="card kpi"><div className="kpi-label">Quotation value</div><div className="kpi-value">{money(total)}</div></div><div className="card kpi"><div className="kpi-label">Quotes</div><div className="kpi-value">{rows.length}</div></div><div className="card kpi"><div className="kpi-label">Win rate</div><div className="kpi-value">{sent.length?Math.round(won.length/sent.length*100):0}%</div></div><div className="card kpi"><div className="kpi-label">Actual-cost variance</div><div className="kpi-value">{money(variance)}</div><div className="kpi-foot">Positive means actual cost exceeded quoted direct cost.</div></div></div><section className="card" style={{marginTop:16}}><div className="card-head"><h2>Value by customer</h2></div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Quoted value</th></tr></thead><tbody>{[...byCustomer.entries()].sort((a,b)=>b[1]-a[1]).map(([n,v])=><tr key={n}><td><strong>{n}</strong></td><td>{money(v)}</td></tr>)}</tbody></table></div></section></>;
}
