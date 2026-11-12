import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";
import { assertSameOrigin, requestId } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { analyzeDrawingNow } from "@/lib/extractor/client";

const paramsSchema = z.object({
  id: z.string().uuid(),
  drawingId: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; drawingId: string }> }
) {
  const traceId = requestId(request);
  try {
    assertSameOrigin(request);
    const params = paramsSchema.parse(await context.params);
    const { supabase, membership, user } = await requireRole(["owner", "admin", "estimator"]);
    await enforceRateLimit(supabase, "POST:/api/rfqs/:id/drawings/:drawingId/analyze", 20, 60);

    // Every lookup is constrained to the authenticated tenant and RFQ.
    const { data: drawing, error: drawingError } = await supabase
      .from("drawings")
      .select("id,storage_path,file_name,mime_type,extraction_status")
      .eq("id", params.drawingId)
      .eq("rfq_id", params.id)
      .eq("tenant_id", membership.tenant_id)
      .maybeSingle();
    if (drawingError) throw drawingError;
    if (!drawing) {
      return NextResponse.json({ error: "Drawing not found", traceId }, { status: 404 });
    }
    if (drawing.extraction_status === "completed") {
      return NextResponse.json({ drawingId: drawing.id, status: "completed", traceId });
    }

    const { data: file, error: fileError } = await supabase.storage
      .from("drawings")
      .download(drawing.storage_path);
    if (fileError || !file) throw fileError ?? new Error("Unable to read uploaded drawing");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const admin = createSupabaseAdminClient();
    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .insert({
        tenant_id: membership.tenant_id,
        rfq_id: params.id,
        drawing_id: drawing.id,
        status: "processing",
        requested_by: user.id,
      })
      .select("id")
      .single();
    if (jobError || !job) throw jobError ?? new Error("Unable to start analysis job");

    const { error: statusError } = await admin
      .from("drawings")
      .update({ extraction_status: "processing" })
      .eq("id", drawing.id)
      .eq("rfq_id", params.id)
      .eq("tenant_id", membership.tenant_id);
    if (statusError) throw statusError;

    try {
      const extraction = await analyzeDrawingNow({
        bytes,
        fileName: drawing.file_name,
        mimeType: drawing.mime_type,
      });
      const warnings = Array.isArray(extraction.warnings)
        ? extraction.warnings.filter((value): value is string => typeof value === "string")
        : [];
      const rawText = typeof extraction.raw_text === "string" ? extraction.raw_text : "";
      const structured = { ...extraction };
      delete structured.raw_text;
      delete structured.warnings;

      const { error: savedError } = await admin.from("drawing_extractions").upsert(
        {
          tenant_id: membership.tenant_id,
          rfq_id: params.id,
          drawing_id: drawing.id,
          schema_version: 1,
          extractor_version: "direct-0.7.2",
          raw_text: rawText,
          structured_data: structured,
          warnings,
        },
        { onConflict: "drawing_id,schema_version" }
      );
      if (savedError) throw savedError;

      const [drawingUpdate, jobUpdate] = await Promise.all([
        admin.from("drawings")
          .update({ extraction_status: "completed" })
          .eq("id", drawing.id)
          .eq("tenant_id", membership.tenant_id),
        admin.from("analysis_jobs")
          .update({ status: "completed", completed_at: new Date().toISOString(), error_message: null })
          .eq("id", job.id)
          .eq("tenant_id", membership.tenant_id),
      ]);
      if (drawingUpdate.error || jobUpdate.error) {
        throw drawingUpdate.error ?? jobUpdate.error;
      }
      return NextResponse.json({ drawingId: drawing.id, status: "completed", traceId });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Drawing analysis failed";
      await Promise.all([
        admin.from("drawings")
          .update({ extraction_status: "queued" })
          .eq("id", drawing.id)
          .eq("tenant_id", membership.tenant_id),
        admin.from("analysis_jobs")
          .update({ status: "queued", error_message: message.slice(0, 1000) })
          .eq("id", job.id)
          .eq("tenant_id", membership.tenant_id),
      ]);
      return NextResponse.json(
        { drawingId: drawing.id, status: "queued", warning: "Analysis temporarily unavailable; file saved for retry.", traceId },
        { status: 202 }
      );
    }
  } catch (cause) {
    console.error("analyze stored drawing failed", { traceId, error: cause });
    const status = cause instanceof z.ZodError ? 400
      : cause instanceof Error && cause.name === "RateLimitError" ? 429 : 500;
    return NextResponse.json(
      { error: status === 400 ? "Invalid drawing identifier" : status === 429 ? "Too many requests" : "Unable to analyze drawing", traceId },
      { status }
    );
  }
}
