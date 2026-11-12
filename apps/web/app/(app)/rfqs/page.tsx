import Link from "next/link";
import { requireSession } from "@/lib/security/auth";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export default async function RfqsPage() {
  const { supabase, membership } = await requireSession();
  const { data } = await supabase.from("rfqs")
    .select("id,quote_number,title,status,currency,total_value,customer_reference,created_at,customers(name)")
    .eq("tenant_id", membership.tenant_id).order("created_at", { ascending: false });
  const rows = data ?? [];
  return <>
    <div className="page-head"><div><h1>RFQs & quotations</h1><p>Controlled commercial records from enquiry through award.</p></div><Link className="btn btn-primary" href="/upload">＋ Upload drawing</Link></div>
    <div className="card">
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>Quote</th><th>Customer</th><th>Title</th><th>Status</th><th>Value</th><th>Created</th></tr></thead><tbody>
        {rows.map((r) => { const c = r.customers as unknown as {name?:string}|null; return <tr key={r.id}><td><Link href={`/rfqs/${r.id}/review`}><strong>{r.quote_number ?? String(r.id).slice(0,8).toUpperCase()}</strong></Link></td><td>{c?.name ?? "—"}</td><td>{r.title}</td><td><span className={`badge badge-${r.status === "ready" ? "ready" : r.status === "review" ? "review" : r.status === "sent" ? "sent" : "draft"}`}>{r.status}</span></td><td>{money.format(Number(r.total_value ?? 0))}</td><td>{new Date(r.created_at).toLocaleDateString("en-IN")}</td></tr>})}
      </tbody></table></div> : <div className="empty"><strong>No commercial records</strong>Start with an RFQ, attach drawings and build the first costed quotation.</div>}
    </div>
  </>;
}
