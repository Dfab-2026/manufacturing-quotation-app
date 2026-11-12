import Link from "next/link";
import { notFound } from "next/navigation";
import { ProcessPlanning } from "@/components/process-planning";
import { requireSession } from "@/lib/security/auth";

type Props = { params: Promise<{ id: string }> };
type ProcessSuggestion = { sequence?: number; operation?: string; work_center?: string | null; reason?: string | null; confidence?: number };

export default async function ProcessPlanningPage({ params }: Props) {
  const { id } = await params;
  const { supabase, membership } = await requireSession();
  const [{ data: rfq }, { data: parts }, { data: extractions }, { data: routes }] = await Promise.all([
    supabase.from("rfqs").select("id,title,quote_number").eq("tenant_id", membership.tenant_id).eq("id", id).maybeSingle(),
    supabase.from("parts").select("id,drawing_id,drawing_number,description,quantity").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at"),
    supabase.from("drawing_extractions").select("drawing_id,structured_data,created_at").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("created_at", { ascending: false }),
    supabase.from("process_routes").select("id,part_id,sequence_no,operation,work_center,setup_minutes,cycle_minutes,quantity,confidence,notes,source").eq("tenant_id", membership.tenant_id).eq("rfq_id", id).order("sequence_no")
  ]);
  if (!rfq) notFound();

  const latestByDrawing = new Map<string, Record<string, unknown>>();
  for (const extraction of extractions ?? []) {
    if (!latestByDrawing.has(extraction.drawing_id)) latestByDrawing.set(extraction.drawing_id, extraction.structured_data as Record<string, unknown>);
  }
  const hasSavedRoutes = (routes ?? []).length > 0;

  return (
    <>
      <div className="page-head">
        <div><span className="eyebrow">Step 3 of 4</span><h1>AI manufacturing process plan</h1><p>{rfq.title} · Review the recommended manufacturing sequence before costing.</p></div>
        <div className="actions"><Link className="btn" href={`/rfqs/${id}/review`}>← Drawing data</Link>{hasSavedRoutes && <Link className="btn btn-primary" href={`/rfqs/${id}/quote`}>Continue to quotation →</Link>}</div>
      </div>
      <div className="flow-progress" aria-label="Quotation progress">
        <div className="flow-progress-item done"><span>✓</span><strong>Upload</strong></div><div className="flow-progress-line done" />
        <div className="flow-progress-item done"><span>✓</span><strong>Drawing analysis</strong></div><div className="flow-progress-line done" />
        <div className="flow-progress-item active"><span>3</span><strong>Process plan</strong></div><div className="flow-progress-line" />
        <div className="flow-progress-item"><span>4</span><strong>Quotation</strong></div>
      </div>

      {(parts ?? []).length ? (parts ?? []).map((part) => {
        const structured = latestByDrawing.get(part.drawing_id) ?? {};
        const suggestions = Array.isArray(structured.manufacturing_processes) ? structured.manufacturing_processes as ProcessSuggestion[] : [];
        const savedForPart = (routes ?? []).filter((route) => route.part_id === part.id);
        const displayed = suggestions.length ? suggestions : savedForPart.map((route) => ({
          sequence: route.sequence_no, operation: route.operation, work_center: route.work_center,
          reason: route.notes, confidence: Number(route.confidence ?? (route.source === "manual" ? 1 : 0.8))
        }));
        return <ProcessPlanning key={part.id} rfqId={id} partId={part.id} partName={part.drawing_number || part.description} quantity={Number(part.quantity) || 1} suggestions={displayed} />;
      }) : (
        <section className="card analysis-state"><h2>Review drawing data first</h2><p>A reviewed part is required before AI manufacturing routing can be approved.</p><Link className="btn btn-primary" href={`/rfqs/${id}/review`}>Review drawing analysis</Link></section>
      )}
    </>
  );
}
