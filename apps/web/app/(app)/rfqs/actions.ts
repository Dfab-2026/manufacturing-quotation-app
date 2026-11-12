"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";

const rfqSchema = z.object({
  customerId: z.string().uuid().nullable(),
  customerReference: z.string().trim().max(100),
  title: z.string().trim().min(2).max(160),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]),
  requiredDate: z.string().trim().optional(),
  notes: z.string().trim().max(2000)
});

export async function createRfq(formData: FormData) {
  const { supabase, membership, user } = await requireRole(["owner", "admin", "estimator"]);
  const parsed = rfqSchema.safeParse({
    customerId: formData.get("customerId") || null,
    customerReference: formData.get("customerReference") ?? "",
    title: formData.get("title") ?? "",
    currency: formData.get("currency") ?? "INR",
    requiredDate: formData.get("requiredDate") || undefined,
    notes: formData.get("notes") ?? ""
  });
  if (!parsed.success) redirect("/rfqs/new?error=invalid-input");

  const { data, error } = await supabase.from("rfqs").insert({
    tenant_id: membership.tenant_id,
    customer_id: parsed.data.customerId,
    customer_reference: parsed.data.customerReference || null,
    title: parsed.data.title,
    currency: parsed.data.currency,
    required_date: parsed.data.requiredDate || null,
    notes: parsed.data.notes || null,
    status: "draft",
    created_by: user.id
  }).select("id").single();

  if (error || !data) redirect("/rfqs/new?error=create-failed");
  const flow = String(formData.get("flow") ?? "");
  redirect(flow === "upload" ? `/rfqs/${data.id}/upload` : `/rfqs/${data.id}`);
}

export async function updateRfqStatus(id: string, status: "draft" | "review" | "ready" | "sent" | "won" | "lost") {
  const { supabase, membership } = await requireRole(["owner", "admin", "estimator"]);
  const { error } = await supabase.from("rfqs").update({ status }).eq("tenant_id", membership.tenant_id).eq("id", id);
  if (error) throw new Error("Unable to update RFQ status");
  revalidatePath(`/rfqs/${id}`);
  revalidatePath("/rfqs");
}
