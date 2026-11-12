import Link from "next/link";
import { getDashboardData } from "@/lib/data/dashboard";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export default async function DashboardPage() {
  const data = await getDashboardData();
  return (
    <>
      <div className="page-head dashboard-head">
        <div>
          <span className="eyebrow">Manufacturing quotation workspace</span>
          <h1>Drawing to quotation, in one controlled flow</h1>
          <p>Upload engineering drawings, review AI-extracted values, edit costing and issue a downloadable quotation.</p>
        </div>
        <Link className="btn btn-primary" href="/upload">＋ Upload drawing</Link>
      </div>

      <section className="workflow-hero card">
        <div className="workflow-copy">
          <span className="workflow-kicker">Start a quotation</span>
          <h2>Upload → Analyze → Review → Quote</h2>
          <p>The estimator remains in control at every stage. AI extracts engineering data; approved values drive deterministic costing.</p>
          <div className="actions">
            <Link className="btn btn-primary" href="/upload">Upload drawing package</Link>
            <Link className="btn" href="/rfqs">Open quotations</Link>
          </div>
        </div>
        <div className="workflow-steps" aria-label="Quotation workflow">
          {["Upload", "AI analysis", "Engineering review", "Quotation"].map((step, index) => (
            <div className="workflow-step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="grid-4" style={{ marginTop: 16 }}>
        <div className="card kpi"><div className="kpi-label">RFQs & quotations</div><div className="kpi-value">{data.quoteCount}</div><div className="kpi-foot">All commercial records</div></div>
        <div className="card kpi"><div className="kpi-label">Pipeline value</div><div className="kpi-value">{money.format(data.pipeline)}</div><div className="kpi-foot">Latest quotation values</div></div>
        <div className="card kpi"><div className="kpi-label">Customers</div><div className="kpi-value">{data.customerCount}</div><div className="kpi-foot">Customer master</div></div>
        <div className="card kpi"><div className="kpi-label">AI analysis queue</div><div className="kpi-value">{data.activeJobs}</div><div className="kpi-foot">Queued or processing</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>Recent quotations</h2><Link className="btn btn-sm" href="/rfqs">View all</Link></div>
        {data.rfqs.length ? (
          <div className="table-wrap"><table><thead><tr><th>Record</th><th>Status</th><th>Value</th><th>Created</th><th></th></tr></thead><tbody>
            {data.rfqs.map((r) => <tr key={r.id}><td><strong>{String(r.id).slice(0,8).toUpperCase()}</strong></td><td><span className={`badge badge-${r.status === "ready" ? "ready" : "draft"}`}>{r.status}</span></td><td>{money.format(Number(r.total_value ?? 0))}</td><td>{new Date(r.created_at).toLocaleDateString("en-IN")}</td><td><Link className="btn btn-sm" href={`/rfqs/${r.id}/review`}>Open</Link></td></tr>)}
          </tbody></table></div>
        ) : <div className="empty"><strong>No quotations yet</strong>Upload your first drawing package to begin.</div>}
      </div>
    </>
  );
}
