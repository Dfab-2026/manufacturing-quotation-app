"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { calculateQuoteTotals, chooseWeight, getDensity, type CostLine } from "@mq/core";
import { requireRole } from "@/lib/security/auth";

const uuid = z.string().uuid();

function n(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function acceptLatestExtraction(rfqId: string, drawingId: string) {
  uuid.parse(rfqId); uuid.parse(drawingId);
  const { supabase, membership } = await requireRole(["owner","admin","estimator"]);

  const { data: extraction } = await supabase.from("drawing_extractions")
    .select("structured_data").eq("tenant_id", membership.tenant_id)
    .eq("rfq_id", rfqId).eq("drawing_id", drawingId)
    .order("schema_version", {ascending:false}).limit(1).maybeSingle();
  if (!extraction) throw new Error("Extraction result not found");

  const s = extraction.structured_data as Record<string, { value?: unknown; confidence?: number }>;
  const material = String(s.material?.value ?? "").replace(/\s+/g, "").toUpperCase();
  const length = n(s.length_mm?.value);
  const width = n(s.width_mm?.value);
  const thickness = n(s.thickness_mm?.value);
  const drawingWeight = n(s.drawing_weight_kg?.value);
  const density = getDensity(material);
  let weight: ReturnType<typeof chooseWeight> | null = null;
  if (density && (drawingWeight || (length && width && thickness))) {
    weight = chooseWeight({
      drawingWeightKg: drawingWeight,
      geometry: length && width && thickness ? {shape:"plate",lengthMm:length,widthMm:width,thicknessMm:thickness} : null,
      densityKgPerM3: density.kgPerM3,
      scrapPercent: 5
    });
  }

  const { error } = await supabase.from("parts").insert({
    tenant_id: membership.tenant_id,
    rfq_id: rfqId,
    drawing_id: drawingId,
    drawing_number: s.drawing_number?.value ? String(s.drawing_number.value) : null,
    revision: s.revision?.value ? String(s.revision.value) : null,
    description: s.description?.value ? String(s.description.value) : "Drawing item",
    quantity: n(s.quantity?.value) ?? 1,
    material_code: material || null,
    length_mm: length,
    width_mm: width,
    thickness_mm: thickness,
    diameter_mm: n(s.diameter_mm?.value),
    drawing_weight_kg: drawingWeight,
    net_weight_kg: weight?.netKg ?? null,
    raw_weight_kg: weight?.rawKg ?? null,
    weight_source: weight?.source ?? null,
    confidence: Math.max(0, Math.min(1, Number(s.drawing_number?.confidence ?? 0.5)))
  });
  if (error) throw new Error("Unable to create reviewed part");
  revalidatePath(`/rfqs/${rfqId}`);
}


const reviewedExtractionSchema = z.object({
  rfqId: z.string().uuid(),
  drawingId: z.string().uuid(),
  drawingNumber: z.string().trim().max(120).nullable(),
  revision: z.string().trim().max(40).nullable(),
  description: z.string().trim().min(1).max(240),
  material: z.string().trim().max(80).nullable(),
  quantity: z.coerce.number().positive().max(1_000_000),
  lengthMm: z.coerce.number().positive().max(1_000_000).nullable(),
  widthMm: z.coerce.number().positive().max(1_000_000).nullable(),
  thicknessMm: z.coerce.number().positive().max(100_000).nullable(),
  diameterMm: z.coerce.number().positive().max(1_000_000).nullable(),
  drawingWeightKg: z.coerce.number().positive().max(10_000_000).nullable(),
  scrapPercent: z.coerce.number().min(0).max(100),
  tolerance: z.string().trim().max(1000),
  surfaceFinish: z.string().trim().max(1000),
  weldDetails: z.string().trim().max(1000),
  holeThreadDetails: z.string().trim().max(1000),
  heatTreatment: z.string().trim().max(1000),
  coating: z.string().trim().max(1000)
});

function nullableText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function nullableNumber(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? Number(text) : null;
}

export async function acceptReviewedExtraction(formData: FormData) {
  const input = reviewedExtractionSchema.parse({
    rfqId: formData.get("rfqId"),
    drawingId: formData.get("drawingId"),
    drawingNumber: nullableText(formData.get("drawingNumber")),
    revision: nullableText(formData.get("revision")),
    description: nullableText(formData.get("description")) ?? "Drawing item",
    material: nullableText(formData.get("material")),
    quantity: formData.get("quantity") ?? 1,
    lengthMm: nullableNumber(formData.get("lengthMm")),
    widthMm: nullableNumber(formData.get("widthMm")),
    thicknessMm: nullableNumber(formData.get("thicknessMm")),
    diameterMm: nullableNumber(formData.get("diameterMm")),
    drawingWeightKg: nullableNumber(formData.get("drawingWeightKg")),
    scrapPercent: formData.get("scrapPercent") ?? 5,
    tolerance: String(formData.get("tolerance") ?? ""),
    surfaceFinish: String(formData.get("surfaceFinish") ?? ""),
    weldDetails: String(formData.get("weldDetails") ?? ""),
    holeThreadDetails: String(formData.get("holeThreadDetails") ?? ""),
    heatTreatment: String(formData.get("heatTreatment") ?? ""),
    coating: String(formData.get("coating") ?? "")
  });

  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const tenantId = membership.tenant_id;

  const [{ data: drawing }, { data: extraction }, { data: existing }] = await Promise.all([
    supabase.from("drawings").select("id").eq("tenant_id", tenantId).eq("rfq_id", input.rfqId).eq("id", input.drawingId).maybeSingle(),
    supabase.from("drawing_extractions").select("structured_data").eq("tenant_id", tenantId).eq("rfq_id", input.rfqId).eq("drawing_id", input.drawingId).order("schema_version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("parts").select("id").eq("tenant_id", tenantId).eq("rfq_id", input.rfqId).eq("drawing_id", input.drawingId).limit(1).maybeSingle()
  ]);

  if (!drawing || !extraction) throw new Error("Drawing extraction is unavailable");
  if (existing) throw new Error("This drawing has already been reviewed");

  const materialCode = (input.material ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const density = materialCode ? getDensity(materialCode) : null;
  let netWeightKg: number | null = null;
  let rawWeightKg: number | null = null;
  let weightSource: "drawing" | "calculated" | null = null;

  if (input.drawingWeightKg) {
    netWeightKg = input.drawingWeightKg;
    rawWeightKg = Math.round(input.drawingWeightKg * (1 + input.scrapPercent / 100) * 1000) / 1000;
    weightSource = "drawing";
  } else if (density && input.lengthMm && input.widthMm && input.thicknessMm) {
    const weight = chooseWeight({
      geometry: {
        shape: "plate",
        lengthMm: input.lengthMm,
        widthMm: input.widthMm,
        thicknessMm: input.thicknessMm
      },
      densityKgPerM3: density.kgPerM3,
      scrapPercent: input.scrapPercent
    });
    netWeightKg = weight.netKg;
    rawWeightKg = weight.rawKg;
    weightSource = "calculated";
  }

  const structured = extraction.structured_data as Record<string, { confidence?: number }>;
  const confidenceValues = Object.values(structured)
    .map((field) => Number(field?.confidence))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0.5;

  const { data: part, error } = await supabase.from("parts").insert({
    tenant_id: tenantId,
    rfq_id: input.rfqId,
    drawing_id: input.drawingId,
    drawing_number: input.drawingNumber,
    revision: input.revision,
    description: input.description,
    quantity: input.quantity,
    material_code: materialCode || null,
    length_mm: input.lengthMm,
    width_mm: input.widthMm,
    thickness_mm: input.thicknessMm,
    diameter_mm: input.diameterMm,
    drawing_weight_kg: input.drawingWeightKg,
    net_weight_kg: netWeightKg,
    raw_weight_kg: rawWeightKg,
    weight_source: weightSource,
    geometry: { scrap_percent: input.scrapPercent, reviewed: true },
    tolerances: input.tolerance ? [input.tolerance] : [],
    finishes: [input.surfaceFinish, input.coating].filter(Boolean),
    notes: [input.weldDetails, input.holeThreadDetails, input.heatTreatment].filter(Boolean),
    confidence: Math.max(0, Math.min(1, confidence))
  }).select("id").single();

  if (error || !part) throw new Error("Unable to save reviewed drawing data");

  const suggestions = Array.isArray((extraction.structured_data as Record<string, unknown>).manufacturing_processes)
    ? ((extraction.structured_data as Record<string, unknown>).manufacturing_processes as Array<Record<string, unknown>>)
    : [];

  const suggestedRoutes = suggestions
    .filter((row) => typeof row?.operation === "string" && row.operation.trim().length >= 2)
    .slice(0, 30)
    .map((row, index) => ({
      tenant_id: tenantId,
      rfq_id: input.rfqId,
      part_id: part.id,
      sequence_no: index + 1,
      operation: String(row.operation).trim().slice(0, 120),
      work_center: typeof row.work_center === "string" && row.work_center.trim() ? row.work_center.trim().slice(0, 120) : null,
      setup_minutes: 0,
      cycle_minutes: 0,
      quantity: input.quantity,
      source: "inferred",
      confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0))),
      notes: typeof row.reason === "string" && row.reason.trim() ? row.reason.trim().slice(0, 500) : null
    }));

  if (suggestedRoutes.length) {
    const { error: routeError } = await supabase.from("process_routes").insert(suggestedRoutes);
    if (routeError) console.error("AI process route save failed", routeError);
  }
  revalidatePath(`/rfqs/${input.rfqId}`);
  revalidatePath(`/rfqs/${input.rfqId}/review`);
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
  const nextPath = typeof formData.get("nextPath") === "string" ? String(formData.get("nextPath")) : "";
  if (nextPath.startsWith(`/rfqs/${input.rfqId}/`)) redirect(nextPath);
}

const routeSchema = z.object({
  rfqId: z.string().uuid(),
  partId: z.string().uuid(),
  operation: z.string().trim().min(2).max(120),
  workCenter: z.string().trim().max(120),
  setupMinutes: z.coerce.number().min(0).max(100000),
  cycleMinutes: z.coerce.number().min(0).max(100000),
  quantity: z.coerce.number().positive().max(1000000),
  rateId: z.string().uuid().nullable()
});

export async function addProcessRoute(formData: FormData) {
  const input = routeSchema.parse({
    rfqId: formData.get("rfqId"),
    partId: formData.get("partId"),
    operation: formData.get("operation"),
    workCenter: formData.get("workCenter") ?? "",
    setupMinutes: formData.get("setupMinutes") ?? 0,
    cycleMinutes: formData.get("cycleMinutes") ?? 0,
    quantity: formData.get("quantity") ?? 1,
    rateId: formData.get("rateId") || null
  });
  const { supabase, membership } = await requireRole(["owner","admin","estimator"]);

  const { data: existing } = await supabase
    .from("process_routes")
    .select("sequence_no")
    .eq("tenant_id", membership.tenant_id)
    .eq("part_id", input.partId)
    .order("sequence_no", { ascending: false })
    .limit(1);

  const sequenceNo = Number(existing?.[0]?.sequence_no ?? 0) + 1;
  const { data: route, error: routeError } = await supabase
    .from("process_routes")
    .insert({
      tenant_id: membership.tenant_id,
      rfq_id: input.rfqId,
      part_id: input.partId,
      sequence_no: sequenceNo,
      operation: input.operation,
      work_center: input.workCenter || null,
      setup_minutes: input.setupMinutes,
      cycle_minutes: input.cycleMinutes,
      quantity: input.quantity,
      rate_id: input.rateId,
      source: "manual"
    })
    .select("id")
    .single();

  if (routeError || !route) throw new Error("Unable to add process route");

  if (input.rateId) {
    const { data: rate } = await supabase
      .from("master_rates")
      .select("name,category,basis,rate")
      .eq("tenant_id", membership.tenant_id)
      .eq("id", input.rateId)
      .eq("active", true)
      .maybeSingle();

    if (!rate) {
      await supabase.from("process_routes").delete().eq("id", route.id);
      throw new Error("Selected master rate is unavailable");
    }

    const totalMinutes = input.setupMinutes + input.cycleMinutes * input.quantity;
    const chargeQuantity = rate.basis === "hour"
      ? totalMinutes / 60
      : rate.basis === "minute"
        ? totalMinutes
        : input.quantity;

    const { error: costError } = await supabase.from("cost_lines").insert({
      tenant_id: membership.tenant_id,
      rfq_id: input.rfqId,
      part_id: input.partId,
      route_id: route.id,
      category: rate.category,
      description: `${input.operation} · ${rate.name}`,
      quantity: chargeQuantity,
      basis: rate.basis,
      rate: rate.rate,
      waste_percent: 0,
      source: "calculated"
    });

    if (costError) {
      await supabase.from("process_routes").delete().eq("id", route.id);
      throw new Error("Unable to create route cost");
    }
  }

  await recalculate(input.rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${input.rfqId}`);
}

const costSchema = z.object({
  rfqId: z.string().uuid(),
  partId: z.string().uuid().nullable(),
  rateId: z.string().uuid(),
  quantity: z.coerce.number().min(0).max(1_000_000_000),
  wastePercent: z.coerce.number().min(0).max(100)
});

export async function updateProcessRoute(formData: FormData) {
  const routeId = uuid.parse(formData.get("routeId"));
  const input = routeSchema.omit({ rateId: true }).parse({
    rfqId: formData.get("rfqId"),
    partId: formData.get("partId"),
    operation: formData.get("operation"),
    workCenter: formData.get("workCenter") ?? "",
    setupMinutes: formData.get("setupMinutes") ?? 0,
    cycleMinutes: formData.get("cycleMinutes") ?? 0,
    quantity: formData.get("quantity") ?? 1
  });
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const { error } = await supabase.from("process_routes").update({
    operation: input.operation,
    work_center: input.workCenter || null,
    setup_minutes: input.setupMinutes,
    cycle_minutes: input.cycleMinutes,
    quantity: input.quantity,
    source: "manual"
  }).eq("tenant_id", membership.tenant_id).eq("rfq_id", input.rfqId).eq("part_id", input.partId).eq("id", routeId);
  if (error) throw new Error("Unable to update manufacturing process");
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
}

export async function deleteProcessRoute(formData: FormData) {
  const rfqId = uuid.parse(formData.get("rfqId"));
  const routeId = uuid.parse(formData.get("routeId"));
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const { error } = await supabase.from("process_routes").delete().eq("tenant_id", membership.tenant_id).eq("rfq_id", rfqId).eq("id", routeId);
  if (error) throw new Error("Unable to delete manufacturing process");
  await recalculate(rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${rfqId}/quote`);
}

export async function addCostLine(formData: FormData) {
  const input = costSchema.parse({
    rfqId: formData.get("rfqId"),
    partId: formData.get("partId") || null,
    rateId: formData.get("rateId"),
    quantity: formData.get("quantity"),
    wastePercent: formData.get("wastePercent") ?? 0
  });
  const { supabase, membership } = await requireRole(["owner","admin","estimator"]);
  const { data: rate } = await supabase.from("master_rates").select("id,name,category,basis,rate").eq("tenant_id", membership.tenant_id).eq("id", input.rateId).eq("active",true).maybeSingle();
  if (!rate) throw new Error("Master rate not found");

  const { error } = await supabase.from("cost_lines").insert({
    tenant_id: membership.tenant_id,
    rfq_id: input.rfqId,
    part_id: input.partId,
    category: rate.category,
    description: rate.name,
    quantity: input.quantity,
    basis: rate.basis,
    rate: rate.rate,
    waste_percent: input.wastePercent,
    source: "manual"
  });
  if (error) throw new Error("Unable to add cost line");
  await recalculate(input.rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${input.rfqId}`);
}

export async function updateCommercials(formData: FormData) {
  const rfqId = uuid.parse(formData.get("rfqId"));
  const overhead = z.coerce.number().min(0).max(100).parse(formData.get("overheadPercent"));
  const margin = z.coerce.number().min(0).max(99.99).parse(formData.get("marginPercent"));
  const { supabase, membership } = await requireRole(["owner","admin","estimator"]);
  const { error } = await supabase.from("rfqs").update({overhead_percent:overhead,margin_percent:margin}).eq("tenant_id",membership.tenant_id).eq("id",rfqId);
  if (error) throw new Error("Unable to update commercial settings");
  await recalculate(rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${rfqId}`);
}

async function recalculate(rfqId: string, supabase: any, tenantId: string) {
  const [{data: rfq}, {data: rows}] = await Promise.all([
    supabase.from("rfqs").select("overhead_percent,margin_percent").eq("tenant_id",tenantId).eq("id",rfqId).single(),
    supabase.from("cost_lines").select("id,category,description,quantity,basis,rate,waste_percent").eq("tenant_id",tenantId).eq("rfq_id",rfqId)
  ]);
  const lines: CostLine[] = (rows ?? []).map((r: any) => ({
    id:r.id, category:r.category, description:r.description, quantity:Number(r.quantity), basis:r.basis,
    rate:Number(r.rate), wastePercent:Number(r.waste_percent ?? 0)
  }));
  const totals = calculateQuoteTotals({lines,overheadPercent:Number(rfq.overhead_percent),marginPercent:Number(rfq.margin_percent),quantity:1});
  await supabase.from("rfqs").update({direct_cost:totals.directCost,total_value:totals.sellingPrice}).eq("tenant_id",tenantId).eq("id",rfqId);
}

export async function requestApproval(formData: FormData) {
  const rfqId = uuid.parse(formData.get("rfqId"));
  const reason = z.string().trim().max(1000).parse(formData.get("reason") ?? "");
  const { supabase, membership, user } = await requireRole(["owner","admin","estimator","sales"]);
  const { data: existing } = await supabase.from("approval_requests").select("id").eq("tenant_id",membership.tenant_id).eq("rfq_id",rfqId).eq("status","pending").maybeSingle();
  if (!existing) {
    const { error } = await supabase.from("approval_requests").insert({tenant_id:membership.tenant_id,rfq_id:rfqId,requested_by:user.id,reason:reason||null});
    if (error) throw new Error("Unable to request quote approval");
  }
  await supabase.from("rfqs").update({approval_state:"pending"}).eq("tenant_id",membership.tenant_id).eq("id",rfqId);
  revalidatePath(`/rfqs/${rfqId}`); revalidatePath("/approvals");
}

export async function saveQuoteVersion(formData: FormData) {
  const rfqId = uuid.parse(formData.get("rfqId"));
  const { supabase, membership, user } = await requireRole(["owner","admin","estimator","sales"]);
  const tenantId=membership.tenant_id;
  const [{data:rfq},{data:parts},{data:routes},{data:costs},{data:last}]=await Promise.all([
    supabase.from("rfqs").select("*").eq("tenant_id",tenantId).eq("id",rfqId).single(),
    supabase.from("parts").select("*").eq("tenant_id",tenantId).eq("rfq_id",rfqId),
    supabase.from("process_routes").select("*").eq("tenant_id",tenantId).eq("rfq_id",rfqId),
    supabase.from("cost_lines").select("*").eq("tenant_id",tenantId).eq("rfq_id",rfqId),
    supabase.from("quote_versions").select("version_no").eq("tenant_id",tenantId).eq("rfq_id",rfqId).order("version_no",{ascending:false}).limit(1).maybeSingle()
  ]);
  const versionNo=Number(last?.version_no??0)+1;
  const {error}=await supabase.from("quote_versions").insert({tenant_id:tenantId,rfq_id:rfqId,version_no:versionNo,snapshot:{rfq,parts:parts??[],routes:routes??[],costs:costs??[]},total_value:Number(rfq.total_value??0),created_by:user.id});
  if(error) throw new Error("Unable to save quotation revision");
  revalidatePath(`/rfqs/${rfqId}`);
}

export async function generateQuantityBreaks(formData: FormData) {
  const rfqId=uuid.parse(formData.get("rfqId"));
  const partId=uuid.parse(formData.get("partId"));
  const quantities=z.string().trim().min(1).parse(formData.get("quantities")).split(",").map(v=>Number(v.trim())).filter(v=>Number.isFinite(v)&&v>0);
  if(!quantities.length) throw new Error("Enter at least one valid quantity");
  const {supabase,membership}=await requireRole(["owner","admin","estimator","sales"]);
  const tenantId=membership.tenant_id;
  const [{data:rfq},{data:rows}]=await Promise.all([
    supabase.from("rfqs").select("overhead_percent,margin_percent").eq("tenant_id",tenantId).eq("id",rfqId).single(),
    supabase.from("cost_lines").select("id,part_id,category,description,quantity,basis,rate,waste_percent").eq("tenant_id",tenantId).eq("rfq_id",rfqId)
  ]);
  const mapped:CostLine[]=(rows??[]).map((r:any)=>({id:r.id,category:r.category,description:r.description,quantity:Number(r.quantity),basis:r.basis,rate:Number(r.rate),wastePercent:Number(r.waste_percent??0)}));
  const setupLines=(rows??[]).filter((r:any)=>!r.part_id).map((r:any)=>mapped.find(x=>x.id===r.id)!).filter(Boolean);
  const variableLines=(rows??[]).filter((r:any)=>r.part_id===partId).map((r:any)=>mapped.find(x=>x.id===r.id)!).filter(Boolean);
  const { calculateQuantityBreaks } = await import("@mq/core");
  const breaks=calculateQuantityBreaks({setupLines,variableLines,quantities,overheadPercent:Number(rfq.overhead_percent),marginPercent:Number(rfq.margin_percent)});
  await supabase.from("quantity_breaks").delete().eq("tenant_id",tenantId).eq("rfq_id",rfqId).eq("part_id",partId);
  const {error}=await supabase.from("quantity_breaks").insert(breaks.map(b=>({tenant_id:tenantId,rfq_id:rfqId,part_id:partId,quantity:b.quantity,unit_price:b.unitPrice,total_price:b.totalPrice,assumptions:{setup_costs:"rfq-level",variable_costs:"selected part"}})));
  if(error) throw new Error("Unable to create quantity pricing");
  revalidatePath(`/rfqs/${rfqId}`);
}

const quoteHeaderSchema = z.object({
  rfqId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  customerReference: z.string().trim().max(100),
  requiredDate: z.string().trim().optional(),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]),
  notes: z.string().trim().max(2000)
});

export async function updateQuoteHeader(formData: FormData) {
  const input = quoteHeaderSchema.parse({
    rfqId: formData.get("rfqId"),
    title: formData.get("title"),
    customerReference: formData.get("customerReference") ?? "",
    requiredDate: formData.get("requiredDate") || undefined,
    currency: formData.get("currency") ?? "INR",
    notes: formData.get("notes") ?? ""
  });
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator", "sales"]);
  const { error } = await supabase.from("rfqs").update({
    title: input.title,
    customer_reference: input.customerReference || null,
    required_date: input.requiredDate || null,
    currency: input.currency,
    notes: input.notes || null
  }).eq("tenant_id", membership.tenant_id).eq("id", input.rfqId);
  if (error) throw new Error("Unable to update quotation details");
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
}

const partQuoteSchema = z.object({
  rfqId: z.string().uuid(),
  partId: z.string().uuid(),
  drawingNumber: z.string().trim().max(120).nullable(),
  revision: z.string().trim().max(40).nullable(),
  description: z.string().trim().min(1).max(240),
  quantity: z.coerce.number().positive().max(1_000_000)
});

export async function updatePartQuoteFields(formData: FormData) {
  const input = partQuoteSchema.parse({
    rfqId: formData.get("rfqId"),
    partId: formData.get("partId"),
    drawingNumber: nullableText(formData.get("drawingNumber")),
    revision: nullableText(formData.get("revision")),
    description: formData.get("description"),
    quantity: formData.get("quantity")
  });
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const { error } = await supabase.from("parts").update({
    drawing_number: input.drawingNumber,
    revision: input.revision,
    description: input.description,
    quantity: input.quantity
  }).eq("tenant_id", membership.tenant_id).eq("rfq_id", input.rfqId).eq("id", input.partId);
  if (error) throw new Error("Unable to update quotation item");
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
}

const manualCostSchema = z.object({
  rfqId: z.string().uuid(),
  partId: z.string().uuid().nullable(),
  category: z.enum(["material", "process", "labor", "consumable", "subcontract", "inspection", "packing", "other"]),
  description: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().min(0).max(1_000_000_000),
  basis: z.enum(["kg", "minute", "hour", "mm", "meter", "bend", "piece", "sqm", "lot"]),
  rate: z.coerce.number().min(0).max(1_000_000_000),
  wastePercent: z.coerce.number().min(0).max(100)
});

export async function addManualCostLine(formData: FormData) {
  const input = manualCostSchema.parse({
    rfqId: formData.get("rfqId"),
    partId: formData.get("partId") || null,
    category: formData.get("category"),
    description: formData.get("description"),
    quantity: formData.get("quantity"),
    basis: formData.get("basis"),
    rate: formData.get("rate"),
    wastePercent: formData.get("wastePercent") ?? 0
  });
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const { error } = await supabase.from("cost_lines").insert({
    tenant_id: membership.tenant_id,
    rfq_id: input.rfqId,
    part_id: input.partId,
    category: input.category,
    description: input.description,
    quantity: input.quantity,
    basis: input.basis,
    rate: input.rate,
    waste_percent: input.wastePercent,
    source: "manual"
  });
  if (error) throw new Error("Unable to add quotation cost line");
  await recalculate(input.rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
}

export async function updateCostLine(formData: FormData) {
  const lineId = uuid.parse(formData.get("lineId"));
  const input = manualCostSchema.parse({
    rfqId: formData.get("rfqId"),
    partId: formData.get("partId") || null,
    category: formData.get("category"),
    description: formData.get("description"),
    quantity: formData.get("quantity"),
    basis: formData.get("basis"),
    rate: formData.get("rate"),
    wastePercent: formData.get("wastePercent") ?? 0
  });
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const { error } = await supabase.from("cost_lines").update({
    part_id: input.partId,
    category: input.category,
    description: input.description,
    quantity: input.quantity,
    basis: input.basis,
    rate: input.rate,
    waste_percent: input.wastePercent,
    source: "manual"
  }).eq("tenant_id", membership.tenant_id).eq("rfq_id", input.rfqId).eq("id", lineId);
  if (error) throw new Error("Unable to update quotation cost line");
  await recalculate(input.rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
}

export async function deleteCostLine(formData: FormData) {
  const rfqId = uuid.parse(formData.get("rfqId"));
  const lineId = uuid.parse(formData.get("lineId"));
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const { error } = await supabase.from("cost_lines").delete().eq("tenant_id", membership.tenant_id).eq("rfq_id", rfqId).eq("id", lineId);
  if (error) throw new Error("Unable to delete quotation cost line");
  await recalculate(rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${rfqId}/quote`);
}

const quoteCommercialSchema = z.object({
  rfqId: z.string().uuid(),
  overheadPercent: z.coerce.number().min(0).max(100),
  marginPercent: z.coerce.number().min(0).max(99.99),
  taxPercent: z.coerce.number().min(0).max(100),
  freightAmount: z.coerce.number().min(0).max(1_000_000_000),
  validityDays: z.coerce.number().int().min(1).max(3650)
});

export async function updateQuoteCommercials(formData: FormData) {
  const input = quoteCommercialSchema.parse({
    rfqId: formData.get("rfqId"),
    overheadPercent: formData.get("overheadPercent") ?? 0,
    marginPercent: formData.get("marginPercent") ?? 0,
    taxPercent: formData.get("taxPercent") ?? 0,
    freightAmount: formData.get("freightAmount") ?? 0,
    validityDays: formData.get("validityDays") ?? 30
  });
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator", "sales"]);
  const { error } = await supabase.from("rfqs").update({
    overhead_percent: input.overheadPercent,
    margin_percent: input.marginPercent,
    tax_percent: input.taxPercent,
    freight_amount: input.freightAmount,
    validity_days: input.validityDays
  }).eq("tenant_id", membership.tenant_id).eq("id", input.rfqId);
  if (error) throw new Error("Unable to update quotation commercials");
  await recalculate(input.rfqId, supabase, membership.tenant_id);
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
}

const suggestedRouteSchema = z.object({
  rfqId: z.string().uuid(),
  partId: z.string().uuid(),
  routesJson: z.string().min(2).max(100_000)
});

const suggestedRouteItemSchema = z.object({
  enabled: z.boolean(),
  operation: z.string().trim().min(2).max(120),
  workCenter: z.string().trim().max(120).nullable(),
  setupMinutes: z.number().min(0).max(100000),
  cycleMinutes: z.number().min(0).max(100000),
  quantity: z.number().positive().max(1_000_000),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().max(500).nullable()
});

export async function saveSuggestedProcessRoutes(formData: FormData) {
  const input = suggestedRouteSchema.parse({
    rfqId: formData.get("rfqId"),
    partId: formData.get("partId"),
    routesJson: formData.get("routesJson")
  });
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);

  let raw: unknown;
  try {
    raw = JSON.parse(input.routesJson);
  } catch {
    throw new Error("Invalid process route payload");
  }
  const routes = z.array(suggestedRouteItemSchema).max(40).parse(raw).filter((route) => route.enabled);
  if (!routes.length) throw new Error("Select at least one manufacturing operation");

  const { data: part } = await supabase
    .from("parts")
    .select("id,quantity")
    .eq("tenant_id", membership.tenant_id)
    .eq("rfq_id", input.rfqId)
    .eq("id", input.partId)
    .maybeSingle();
  if (!part) throw new Error("Reviewed part not found");

  const { error: deleteError } = await supabase
    .from("process_routes")
    .delete()
    .eq("tenant_id", membership.tenant_id)
    .eq("rfq_id", input.rfqId)
    .eq("part_id", input.partId)
    .eq("source", "inferred");
  if (deleteError) throw new Error("Unable to replace AI process route");

  const { data: retainedRoutes } = await supabase
    .from("process_routes")
    .select("sequence_no")
    .eq("tenant_id", membership.tenant_id)
    .eq("rfq_id", input.rfqId)
    .eq("part_id", input.partId)
    .neq("source", "inferred")
    .order("sequence_no", { ascending: false })
    .limit(1);
  const sequenceOffset = Number(retainedRoutes?.[0]?.sequence_no ?? 0);

  const rows = routes.map((route, index) => ({
    tenant_id: membership.tenant_id,
    rfq_id: input.rfqId,
    part_id: input.partId,
    sequence_no: sequenceOffset + index + 1,
    operation: route.operation,
    work_center: route.workCenter || null,
    setup_minutes: route.setupMinutes,
    cycle_minutes: route.cycleMinutes,
    quantity: route.quantity || Number(part.quantity) || 1,
    source: "inferred" as const,
    confidence: route.confidence,
    notes: route.reason || null
  }));

  const { error } = await supabase.from("process_routes").insert(rows);
  if (error) throw new Error(`Unable to save AI process route: ${error.message}`);

  revalidatePath(`/rfqs/${input.rfqId}`);
  revalidatePath(`/rfqs/${input.rfqId}/process`);
  revalidatePath(`/rfqs/${input.rfqId}/quote`);
}
