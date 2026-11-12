import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisWaiter } from "@/components/analysis-waiter";
import { ExtractionReview } from "@/components/extraction-review";
import { requireSession } from "@/lib/security/auth";

type Props = { params: Promise<{ id: string }> };

export default async function DrawingReviewPage({ params }: Props) {
  const { id } = await params;
  const { supabase, membership } = await requireSession();
  const [{ data: rfq }, { data: drawings }, { data: extractions }, { data: parts }, { data: jobs }] = await Promise.all([
    supabase.from("rfqs").select("id,title,quote_number").eq("tenant_id", membership.tenant_id).eq("id", id).maybeSingle(),
    supabase.from("drawings").select("id,file_name,mime_type,extraction_status,created_at").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at", { ascending: false }),
    supabase.from("drawing_extractions").select("id,drawing_id,structured_data,warnings,created_at").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at", { ascending: false }),
    supabase.from("parts").select("id,drawing_id,drawing_number,description,material_code,quantity").eq("tenant_id", membership.tenant_id).eq("rfq_id", id),
    supabase.from("analysis_jobs").select("id,status,error_message").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at", { ascending: false })
  ]);
  if (!rfq) notFound();

  const reviewed = new Set((parts ?? []).map((part) => part.drawing_id));
  const latest = (extractions ?? []).find((item) => !reviewed.has(item.drawing_id)) ?? extractions?.[0] ?? null;
  const drawing = latest ? (drawings ?? []).find((item) => item.id === latest.drawing_id) ?? null : null;
  const extracted = (latest?.structured_data ?? {}) as Record<string, { value?: string | number | null; confidence?: number; evidence?: string | null; source?: string | null }>;
  const waiting = (drawings ?? []).some((item) => ["queued", "processing"].includes(item.extraction_status));
  const failed = (jobs ?? []).find((job) => job.status === "failed");
  const drawingsRemainingAfterCurrent = Math.max(0, (drawings ?? []).length - reviewed.size - (latest && !reviewed.has(latest.drawing_id) ? 1 : 0));
  const reviewNextPath = drawingsRemainingAfterCurrent > 0 ? `/rfqs/${id}/review` : `/rfqs/${id}/quote`;

  return (
    <>
      <AnalysisWaiter active={waiting && !latest} />
      <div className="page-head">
        <div><span className="eyebrow">Step 2 of 3</span><h1>Review extracted drawing data</h1><p>{rfq.title} · AI analyzed the drawing. Verify and edit the extracted values before quotation.</p></div>
        <div className="actions"><Link className="btn" href={`/rfqs/${id}/upload`}>← Add drawings</Link>{(parts ?? []).length > 0 && <Link className="btn btn-primary" href={`/rfqs/${id}/quote`}>Continue to quotation →</Link>}</div>
      </div>
      <div className="flow-progress" aria-label="Quotation progress">
        <div className="flow-progress-item done"><span>✓</span><strong>Upload & analyze</strong></div><div className="flow-progress-line done" />
        <div className="flow-progress-item active"><span>2</span><strong>Analyzed data</strong></div><div className="flow-progress-line" />
        <div className="flow-progress-item"><span>3</span><strong>Quotation</strong></div>
      </div>

      {latest && drawing && !reviewed.has(latest.drawing_id) ? (
        <section className="card review-card standalone-review">
          <ExtractionReview rfqId={id} drawingId={latest.drawing_id} fileName={drawing.file_name} mimeType={drawing.mime_type} extracted={extracted} warnings={(latest.warnings as string[] | null) ?? []} nextPath={reviewNextPath} />
        </section>
      ) : waiting ? (
        <section className="card analysis-state"><div className="analysis-spinner" /><h2>Analyzing drawing package</h2><p>Extracting title-block data, material, dimensions, weight and engineering notes. This page refreshes automatically.</p><div className="analysis-status-list">{(drawings ?? []).map((item) => <div key={item.id}><strong>{item.file_name}</strong><span className={`badge badge-${item.extraction_status === "completed" ? "ready" : "draft"}`}>{item.extraction_status}</span></div>)}</div></section>
      ) : failed ? (
        <section className="card analysis-state"><h2>Analysis needs attention</h2><p>{failed.error_message || "The extractor could not complete this drawing."}</p><Link className="btn btn-primary" href={`/rfqs/${id}/upload`}>Upload another drawing</Link></section>
      ) : (parts ?? []).length > 0 ? (
        <section className="card analysis-state"><div className="review-approved-icon">✓</div><h2>Engineering data reviewed</h2><p>{parts?.length} reviewed part{parts?.length === 1 ? "" : "s"} are ready for quotation.</p><Link className="btn btn-primary" href={`/rfqs/${id}/quote`}>Open quotation →</Link></section>
      ) : (
        <section className="card analysis-state"><h2>No drawing analysis available</h2><p>Upload at least one drawing to begin extraction.</p><Link className="btn btn-primary" href={`/rfqs/${id}/upload`}>Upload drawings</Link></section>
      )}

      {(parts ?? []).length > 0 && (
        <section className="card" style={{ marginTop: 16 }}><div className="card-head"><h2>Reviewed parts</h2></div><div className="table-wrap"><table><thead><tr><th>Drawing</th><th>Description</th><th>Material</th><th>Qty</th></tr></thead><tbody>{(parts ?? []).map((part) => <tr key={part.id}><td><strong>{part.drawing_number || "—"}</strong></td><td>{part.description}</td><td>{part.material_code || "—"}</td><td>{Number(part.quantity)}</td></tr>)}</tbody></table></div></section>
      )}
    </>
  );
}
