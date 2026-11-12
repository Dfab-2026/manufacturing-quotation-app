"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";

export async function decideApproval(formData:FormData){
  const input=z.object({id:z.string().uuid(),rfqId:z.string().uuid(),decision:z.enum(["approved","rejected"]),note:z.string().trim().max(1000)}).parse({id:formData.get("id"),rfqId:formData.get("rfqId"),decision:formData.get("decision"),note:formData.get("note")??""});
  const {supabase,membership,user}=await requireRole(["owner","admin","approver"]);
  const {error}=await supabase.from("approval_requests").update({status:input.decision,decided_by:user.id,decided_at:new Date().toISOString(),decision_note:input.note||null}).eq("tenant_id",membership.tenant_id).eq("id",input.id).eq("status","pending");
  if(error) throw new Error("Unable to record approval decision");
  await supabase.from("rfqs").update({approval_state:input.decision,approved_by:input.decision==="approved"?user.id:null,approved_at:input.decision==="approved"?new Date().toISOString():null}).eq("tenant_id",membership.tenant_id).eq("id",input.rfqId);
  revalidatePath("/approvals"); revalidatePath(`/rfqs/${input.rfqId}`);
}
