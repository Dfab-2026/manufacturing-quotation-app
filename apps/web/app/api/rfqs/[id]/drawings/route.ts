import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";
import { assertSameOrigin, requestId } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertDrawingQuota } from "@/lib/subscription/limits";
import { analyzeDrawingNow } from "@/lib/extractor/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const paramsSchema = z.object({ id: z.string().uuid() });
const maxBytes = 25 * 1024 * 1024;

const formats: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".dxf": "application/dxf",
  ".dwg": "application/acad",
  ".step": "application/step",
  ".stp": "application/step",
  ".iges": "model/iges",
  ".igs": "model/iges",
  ".zip": "application/zip",
};

function extension(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const traceId = requestId(request);

  try {
    assertSameOrigin(request);
    const params = paramsSchema.parse(await context.params);
    const { supabase, membership, user } = await requireRole([
      "owner",
      "admin",
      "estimator",
    ]);

    await enforceRateLimit(supabase, "POST:/api/rfqs/:id/drawings", 20, 60);
    await assertDrawingQuota(supabase, membership.tenant_id);

    const { data: rfq } = await supabase
      .from("rfqs")
      .select("id")
      .eq("tenant_id", membership.tenant_id)
      .eq("id", params.id)
      .maybeSingle();

    if (!rfq) {
      return NextResponse.json({ error: "RFQ not found", traceId }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Drawing file is required", traceId },
        { status: 400 }
      );
    }

    const ext = extension(file.name);
    const normalizedType = formats[ext];
    if (!normalizedType) {
      return NextResponse.json(
        { error: "Unsupported drawing format", traceId },
        { status: 415 }
      );
    }
    if (file.size <= 0 || file.size > maxBytes) {
      return NextResponse.json(
        { error: "Each drawing must be between 1 byte and 25 MB", traceId },
        { status: 413 }
      );
    }

    const drawingId = crypto.randomUUID();
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
    const path = `${membership.tenant_id}/${params.id}/${drawingId}/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = normalizedType;

    const upload = await supabase.storage
      .from("drawings")
      .upload(path, bytes, { contentType, upsert: false });
    if (upload.error) throw upload.error;

    const { error: insertError } = await supabase.from("drawings").insert({
      id: drawingId,
      tenant_id: membership.tenant_id,
      rfq_id: params.id,
      file_name: safeName,
      storage_path: path,
      mime_type: contentType,
      size_bytes: file.size,
      extraction_status: "processing",
      uploaded_by: user.id,
    });

    if (insertError) {
      await supabase.storage.from("drawings").remove([path]);
      throw insertError;
    }

    // Upload-only mode returns as soon as Supabase confirms persistence;
    // it does not create a processing job or wait for Gemini.
    if (request.nextUrl.searchParams.get("uploadOnly") === "1") {
      return NextResponse.json(
        { drawingId, status: "uploaded", analyzed: false, traceId },
        { status: 201 }
      );
    }

    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .insert({
        tenant_id: membership.tenant_id,
        rfq_id: params.id,
        drawing_id: drawingId,
        status: "processing",
        requested_by: user.id,
      })
      .select("id")
      .single();

    if (jobError || !job) throw jobError ?? new Error("Unable to create analysis job");

    try {
      const extraction = await analyzeDrawingNow({
        bytes,
        fileName: safeName,
        mimeType: contentType,
      });

      const warnings = Array.isArray(extraction.warnings)
        ? extraction.warnings.filter((item): item is string => typeof item === "string")
        : [];
      const rawText = typeof extraction.raw_text === "string" ? extraction.raw_text : "";
      const structured = { ...extraction };
      delete structured.raw_text;
      delete structured.warnings;

      const admin = createSupabaseAdminClient();
      const { error: extractionError } = await admin
        .from("drawing_extractions")
        .upsert(
          {
            tenant_id: membership.tenant_id,
            rfq_id: params.id,
            drawing_id: drawingId,
            schema_version: 1,
            extractor_version: "direct-0.7",
            raw_text: rawText,
            structured_data: structured,
            warnings,
          },
          { onConflict: "drawing_id,schema_version" }
        );
      if (extractionError) throw extractionError;

      await Promise.all([
        admin
          .from("drawings")
          .update({ extraction_status: "completed" })
          .eq("id", drawingId),
        admin
          .from("analysis_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", job.id),
      ]);

      return NextResponse.json(
        {
          drawingId,
          status: "completed",
          analyzed: true,
          traceId,
        },
        { status: 201 }
      );
    } catch (analysisError) {
      // Do not lose the drawing if the direct extractor is temporarily unavailable.
      // Return it to the queue so the optional worker can retry the same secure job.
      const admin = createSupabaseAdminClient();
      const message = analysisError instanceof Error ? analysisError.message : "Direct analysis failed";
      await Promise.all([
        admin
          .from("drawings")
          .update({ extraction_status: "queued" })
          .eq("id", drawingId),
        admin
          .from("analysis_jobs")
          .update({ status: "queued", error_message: message.slice(0, 1000) })
          .eq("id", job.id),
      ]);

      return NextResponse.json(
        {
          drawingId,
          status: "queued",
          analyzed: false,
          warning: "Direct analysis is unavailable. The drawing was safely queued for retry.",
          traceId,
        },
        { status: 202 }
      );
    }
  } catch (error) {
    console.error("drawing upload failed", { traceId, error });
    const message = error instanceof Error ? error.message : "";
    const status =
      error instanceof z.ZodError
        ? 400
        : error instanceof Error && error.name === "RateLimitError"
          ? 429
          : ["DrawingQuotaExceeded", "SubscriptionInactive"].includes(message)
            ? 402
            : 500;
    const publicError =
      status === 400
        ? "Invalid request"
        : status === 429
          ? "Too many uploads"
          : message === "DrawingQuotaExceeded"
            ? "Monthly drawing limit reached for this plan"
            : message === "SubscriptionInactive"
              ? "Subscription is not active"
              : "Unable to upload drawing";
    return NextResponse.json({ error: publicError, traceId }, { status });
  }
}
