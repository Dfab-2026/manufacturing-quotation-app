import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/security/auth";
import { assertSameOrigin, requestId } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  customerId: z.string().uuid().nullable().optional(),
  customerReference: z.string().trim().max(100).optional(),
  currency: z.enum(["INR","USD","EUR","GBP"]).default("INR")
});

export async function GET() {
  const { supabase, membership } = await requireSession();
  const { data, error } = await supabase.from("rfqs").select("id,quote_number,title,status,currency,total_value,created_at").eq("tenant_id", membership.tenant_id).order("created_at", {ascending:false}).limit(100);
  if (error) return NextResponse.json({error:"Unable to load RFQs"},{status:500});
  return NextResponse.json({data});
}

export async function POST(request: NextRequest) {
  const traceId = requestId(request);
  try {
    assertSameOrigin(request);
    const { supabase, membership, user } = await requireRole(["owner","admin","estimator"]);
    await enforceRateLimit(supabase, "POST:/api/rfqs", 30, 60);
    const body = createSchema.parse(await request.json());
    const { data, error } = await supabase.from("rfqs").insert({
      tenant_id: membership.tenant_id,
      title: body.title,
      customer_id: body.customerId ?? null,
      customer_reference: body.customerReference || null,
      currency: body.currency,
      status: "draft",
      created_by: user.id
    }).select("id,quote_number,title,status").single();
    if (error) throw error;
    return NextResponse.json({data,traceId},{status:201});
  } catch (error) {
    console.error("rfq create failed", { traceId, error });
    const status = error instanceof z.ZodError ? 400 : error instanceof Error && error.name === "RateLimitError" ? 429 : 500;
    return NextResponse.json({error: status === 400 ? "Invalid RFQ payload" : status === 429 ? "Too many requests" : "Unable to create RFQ",traceId},{status});
  }
}
