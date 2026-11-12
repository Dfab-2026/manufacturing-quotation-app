"use server";
import { revalidatePath } from "next/cache"; import { z } from "zod"; import { requireRole } from "@/lib/security/auth";
export async function updateCompanySettings(formData:FormData){
 const x=z.object({legalName:z.string().trim().max(160),taxId:z.string().trim().max(60),currency:z.enum(["INR","USD","EUR","GBP"]),tax:z.coerce.number().min(0).max(100),scrap:z.coerce.number().min(0).max(100),terms:z.string().trim().max(4000),address:z.string().trim().max(1500)}).parse({legalName:formData.get("legalName")??"",taxId:formData.get("taxId")??"",currency:formData.get("currency")??"INR",tax:formData.get("tax")??18,scrap:formData.get("scrap")??5,terms:formData.get("terms")??"",address:formData.get("address")??""});
 const {supabase,membership}=await requireRole(["owner","admin"]); const {error}=await supabase.from("tenants").update({legal_name:x.legalName||null,tax_id:x.taxId||null,default_currency:x.currency,default_tax_percent:x.tax,default_scrap_percent:x.scrap,quote_terms:x.terms||null,address:x.address?{text:x.address}:{}}).eq("id",membership.tenant_id); if(error) throw new Error("Unable to update company settings"); revalidatePath("/settings");
}
