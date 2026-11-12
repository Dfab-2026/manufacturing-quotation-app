import { notFound } from "next/navigation";
import Link from "next/link";
import { DrawingUpload } from "@/components/drawing-upload";
import { requireSession } from "@/lib/security/auth";

type Props = { params: Promise<{ id: string }> };

export default async function DrawingUploadPage({ params }: Props) {
  const { id } = await params;
  const { supabase, membership } = await requireSession();
  const [{ data: rfq }, { data: drawings }] = await Promise.all([
    supabase.from("rfqs").select("id,title,quote_number").eq("tenant_id", membership.tenant_id).eq("id", id).maybeSingle(),
    supabase.from("drawings").select("id,file_name,mime_type,size_bytes,extraction_status,created_at").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at", { ascending: false })
  ]);
  if (!rfq) notFound();

  return (
    <>
      <div className="page-head">
        <div><span className="eyebrow">Step 1 of 3</span><h1>Upload engineering drawings</h1><p>{rfq.title}</p></div>
        <Link className="btn" href="/rfqs">Save & exit</Link>
      </div>
      <div className="flow-progress" aria-label="Quotation progress">
        <div className="flow-progress-item active"><span>1</span><strong>Upload & analyze</strong></div><div className="flow-progress-line" />
        <div className="flow-progress-item"><span>2</span><strong>Analyzed data</strong></div><div className="flow-progress-line" />
        <div className="flow-progress-item"><span>3</span><strong>Quotation</strong></div>
      </div>

      <section className="card drawing-upload-card">
        <div className="card-head"><div><h2>Drawing package</h2><span className="help">Upload one or multiple files. Each file is stored privately and queued for analysis.</span></div></div>
        <div className="card-body"><DrawingUpload rfqId={id} redirectAfterUpload={`/rfqs/${id}/review`} /></div>
      </section>

      {(drawings ?? []).length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Files in this quotation</h2><Link className="btn btn-primary btn-sm" href={`/rfqs/${id}/review`}>Continue to analysis →</Link></div>
          <div className="table-wrap"><table><thead><tr><th>File</th><th>Format</th><th>Status</th><th>Size</th></tr></thead><tbody>
            {(drawings ?? []).map((drawing) => <tr key={drawing.id}><td><strong>{drawing.file_name}</strong></td><td>{drawing.mime_type || "CAD / drawing"}</td><td><span className={`badge badge-${drawing.extraction_status === "completed" ? "ready" : drawing.extraction_status === "failed" ? "review" : "draft"}`}>{drawing.extraction_status}</span></td><td>{(Number(drawing.size_bytes) / 1024 / 1024).toFixed(2)} MB</td></tr>)}
          </tbody></table></div>
        </section>
      )}
    </>
  );
}
