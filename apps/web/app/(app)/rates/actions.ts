"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(["material","process","labor","consumable","subcontract","inspection","packing","other"]),
  basis: z.enum(["kg","minute","hour","mm","meter","bend","piece","sqm","lot"]),
  rate: z.coerce.number().min(0).max(1_000_000_000),
  currency: z.enum(["INR","USD","EUR","GBP"]),
  materialCode: z.string().trim().max(40)
});

export async function createRate(formData: FormData) {
  const { supabase, membership, user } = await requireRole(["owner","admin"]);
  const data = schema.parse({
    name: formData.get("name"), category: formData.get("category"), basis: formData.get("basis"),
    rate: formData.get("rate"), currency: formData.get("currency"), materialCode: formData.get("materialCode") ?? ""
  });
  const { error } = await supabase.from("master_rates").insert({
    tenant_id: membership.tenant_id, name: data.name, category: data.category, basis: data.basis,
    rate: data.rate, currency: data.currency, material_code: data.materialCode || null, active: true, created_by: user.id
  });
  if (error) throw new Error("Unable to save master rate");
  revalidatePath("/rates");
}


export async function updateRate(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const rate = z.coerce.number().finite().min(0).max(1_000_000_000).parse(formData.get("rate"));
  const { supabase, membership } = await requireRole(["owner", "admin"]);
  const { data, error } = await supabase.from("master_rates")
    .update({ rate })
    .eq("tenant_id", membership.tenant_id)
    .eq("id", id)
    .select("id").maybeSingle();
  if (error || !data) throw new Error("Could not save rate. Check permissions and try again.");
  revalidatePath("/rates");
}
