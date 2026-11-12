"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().max(30),
  contactPerson: z.string().trim().max(120),
  email: z.string().trim().email().or(z.literal("")),
  phone: z.string().trim().max(30),
  gstin: z.string().trim().max(20),
  currency: z.enum(["INR","USD","EUR","GBP"]),
  paymentTerms: z.string().trim().max(500),
  margin: z.union([z.coerce.number().min(0).max(99.99), z.literal("")]),
  billingAddress: z.string().trim().max(1000),
  shippingAddress: z.string().trim().max(1000)
});

export async function createCustomer(formData: FormData) {
  const { supabase, membership, user } = await requireRole(["owner","admin","estimator"]);
  const parsed = schema.parse({
    name: formData.get("name") ?? "", code: formData.get("code") ?? "", contactPerson: formData.get("contactPerson") ?? "",
    email: formData.get("email") ?? "", phone: formData.get("phone") ?? "", gstin: formData.get("gstin") ?? "",
    currency: formData.get("currency") ?? "INR", paymentTerms: formData.get("paymentTerms") ?? "", margin: formData.get("margin") ?? "",
    billingAddress: formData.get("billingAddress") ?? "", shippingAddress: formData.get("shippingAddress") ?? ""
  });
  const { error } = await supabase.from("customers").insert({
    tenant_id: membership.tenant_id, name: parsed.name, code: parsed.code || null, contact_person: parsed.contactPerson || null,
    email: parsed.email || null, phone: parsed.phone || null, gstin: parsed.gstin || null, currency: parsed.currency,
    payment_terms: parsed.paymentTerms || null, default_margin_percent: parsed.margin === "" ? null : parsed.margin,
    billing_address: parsed.billingAddress ? { text: parsed.billingAddress } : {}, shipping_address: parsed.shippingAddress ? { text: parsed.shippingAddress } : {},
    active: true, created_by: user.id
  });
  if (error) throw new Error("Unable to create customer");
  revalidatePath("/customers");
}
