"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";

const code = z.string().trim().min(1).max(40).transform(v => v.toUpperCase());
const money = z.coerce.number().min(0).max(1_000_000_000);

export async function createMaterial(formData: FormData) {
  const input = z.object({
    code, name:z.string().trim().min(2).max(120), grade:z.string().trim().max(80),
    density:z.coerce.number().positive().max(30000), rate:money,
    scrap:z.coerce.number().min(0).max(100)
  }).parse({code:formData.get("code"),name:formData.get("name"),grade:formData.get("grade")??"",density:formData.get("density"),rate:formData.get("rate")??0,scrap:formData.get("scrap")??5});
  const {supabase,membership,user}=await requireRole(["owner","admin"]);
  const {error}=await supabase.from("material_masters").insert({tenant_id:membership.tenant_id,code:input.code,name:input.name,grade:input.grade||null,density_kg_m3:input.density,purchase_rate:input.rate,scrap_percent:input.scrap,created_by:user.id});
  if(error) throw new Error("Unable to save material master");
  revalidatePath("/masters");
}

export async function createMachine(formData: FormData) {
  const input=z.object({code,name:z.string().trim().min(2).max(120),type:z.string().trim().min(2).max(120),hourly:money,setup:money}).parse({code:formData.get("code"),name:formData.get("name"),type:formData.get("type"),hourly:formData.get("hourly")??0,setup:formData.get("setup")??0});
  const {supabase,membership,user}=await requireRole(["owner","admin"]);
  const {error}=await supabase.from("machine_masters").insert({tenant_id:membership.tenant_id,code:input.code,name:input.name,machine_type:input.type,hourly_rate:input.hourly,setup_rate:input.setup,created_by:user.id});
  if(error) throw new Error("Unable to save machine master");
  revalidatePath("/masters");
}

export async function createProcess(formData: FormData) {
  const input=z.object({code,name:z.string().trim().min(2).max(120),basis:z.enum(["kg","minute","hour","mm","meter","bend","piece","sqm","lot"]),rate:money,minimum:money,setup:z.coerce.number().min(0).max(100000)}).parse({code:formData.get("code"),name:formData.get("name"),basis:formData.get("basis"),rate:formData.get("rate")??0,minimum:formData.get("minimum")??0,setup:formData.get("setup")??0});
  const {supabase,membership,user}=await requireRole(["owner","admin"]);
  const {error}=await supabase.from("process_masters").insert({tenant_id:membership.tenant_id,code:input.code,name:input.name,default_basis:input.basis,default_rate:input.rate,minimum_charge:input.minimum,default_setup_minutes:input.setup,created_by:user.id});
  if(error) throw new Error("Unable to save process master");
  revalidatePath("/masters");
}

export async function createSupplier(formData: FormData) {
  const input=z.object({code:z.string().trim().max(40),name:z.string().trim().min(2).max(160),email:z.string().trim().email().or(z.literal("")),phone:z.string().trim().max(40),lead:z.coerce.number().int().min(0).max(3650)}).parse({code:formData.get("code")??"",name:formData.get("name"),email:formData.get("email")??"",phone:formData.get("phone")??"",lead:formData.get("lead")??0});
  const {supabase,membership,user}=await requireRole(["owner","admin","finance"]);
  const {error}=await supabase.from("suppliers").insert({tenant_id:membership.tenant_id,code:input.code||null,name:input.name,email:input.email||null,phone:input.phone||null,lead_time_days:input.lead,created_by:user.id});
  if(error) throw new Error("Unable to save supplier");
  revalidatePath("/masters");
}
