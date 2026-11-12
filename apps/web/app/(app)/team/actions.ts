"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/security/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertUserQuota } from "@/lib/subscription/limits";

const role=z.enum(["owner","admin","estimator","viewer","sales","approver","production","finance"]);
export async function inviteMember(formData:FormData){
 const email=z.string().trim().email().parse(formData.get("email")); const selected=role.parse(formData.get("role"));
 const {supabase,membership}=await requireRole(["owner","admin"]); await assertUserQuota(supabase,membership.tenant_id); const admin=createSupabaseAdminClient();
 const {data,error}=await admin.auth.admin.inviteUserByEmail(email,{data:{invited_tenant_id:membership.tenant_id}}); if(error||!data.user) throw new Error(error?.message||"Unable to invite user");
 const {error:memberError}=await admin.from("memberships").upsert({tenant_id:membership.tenant_id,user_id:data.user.id,role:selected,status:"invited"},{onConflict:"tenant_id,user_id"});
 if(memberError) throw new Error("Invite sent but membership could not be created"); revalidatePath("/team");
}
export async function changeRole(formData:FormData){
 const id=z.string().uuid().parse(formData.get("id")); const selected=role.parse(formData.get("role")); const {supabase,membership}=await requireRole(["owner","admin"]);
 const {error}=await supabase.from("memberships").update({role:selected}).eq("tenant_id",membership.tenant_id).eq("id",id); if(error) throw new Error("Unable to change role"); revalidatePath("/team");
}
