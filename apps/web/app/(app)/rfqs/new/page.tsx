import Link from "next/link";
import { createRfq } from "../actions";
import { requireRole } from "@/lib/security/auth";

type Props = { searchParams: Promise<Record<string,string|string[]|undefined>> };

export default async function NewRfqPage({ searchParams }: Props) {
  const { supabase, membership } = await requireRole(["owner","admin","estimator"]);
  const params = await searchParams;
  const { data: customers } = await supabase.from("customers").select("id,name").eq("tenant_id", membership.tenant_id).eq("active", true).order("name");
  return <>
    <div className="page-head"><div><h1>New RFQ</h1><p>Create the commercial record before drawings are analyzed.</p></div><Link className="btn" href="/rfqs">Cancel</Link></div>
    <form action={createRfq} className="card"><div className="card-head"><h2>RFQ details</h2></div><div className="card-body">
      {params.error && <div className="error" style={{marginBottom:16}}>Check the required RFQ fields and try again.</div>}
      <div className="form-grid">
        <div className="field"><label htmlFor="title">RFQ title *</label><input className="input" id="title" name="title" required maxLength={160} placeholder="e.g. Stainless process skid fabrication" /></div>
        <div className="field"><label htmlFor="customerId">Customer</label><select className="select" id="customerId" name="customerId"><option value="">Unassigned</option>{(customers??[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field field-4"><label htmlFor="customerReference">Customer RFQ / PO reference</label><input className="input" id="customerReference" name="customerReference" maxLength={100}/></div>
        <div className="field field-4"><label htmlFor="requiredDate">Required delivery / quote date</label><input className="input" id="requiredDate" name="requiredDate" type="date"/></div>
        <div className="field field-4"><label htmlFor="currency">Currency</label><select className="select" id="currency" name="currency" defaultValue="INR"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></div>
        <div className="field field-full"><label htmlFor="notes">Internal enquiry notes</label><textarea className="textarea" id="notes" name="notes" maxLength={2000}/></div>
      </div>
    </div><div className="card-head" style={{justifyContent:"flex-end"}}><button className="btn btn-primary" type="submit">Create RFQ & continue</button></div></form>
  </>;
}
