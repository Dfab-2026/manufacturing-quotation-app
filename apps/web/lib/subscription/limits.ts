export async function getTenantPlan(supabase:any, tenantId:string){
  const {data:sub}=await supabase.from("tenant_subscriptions").select("plan_code,status,trial_ends_at,current_period_end").eq("tenant_id",tenantId).maybeSingle();
  if(!sub) return null;
  const {data:plan}=await supabase.from("subscription_plans").select("code,max_users,drawings_per_month,storage_gb,features").eq("code",sub.plan_code).maybeSingle();
  return plan?{...sub,plan}:null;
}

export async function assertDrawingQuota(supabase:any, tenantId:string){
  const current=await getTenantPlan(supabase,tenantId); if(!current) return;
  if(["past_due","cancelled"].includes(current.status)) throw new Error("SubscriptionInactive");
  const start=new Date(); start.setUTCDate(1); start.setUTCHours(0,0,0,0);
  const {count}=await supabase.from("drawings").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).gte("created_at",start.toISOString());
  if((count??0)>=Number(current.plan.drawings_per_month)) throw new Error("DrawingQuotaExceeded");
}

export async function assertUserQuota(supabase:any, tenantId:string){
  const current=await getTenantPlan(supabase,tenantId); if(!current) return;
  const {count}=await supabase.from("memberships").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).neq("status","disabled");
  if((count??0)>=Number(current.plan.max_users)) throw new Error("UserQuotaExceeded");
}
