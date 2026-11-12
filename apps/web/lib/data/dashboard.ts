import { requireSession } from "@/lib/security/auth";

export async function getDashboardData() {
  const { supabase, membership } = await requireSession();
  const tenantId = membership.tenant_id;
  const [rfqs, customers, jobs] = await Promise.all([
    supabase.from("rfqs").select("id,status,total_value,created_at", { count: "exact" }).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(8),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("analysis_jobs").select("id,status", { count: "exact" }).eq("tenant_id", tenantId).in("status", ["queued","processing"])
  ]);
  const rows = rfqs.data ?? [];
  const pipeline = rows.reduce((sum, r) => sum + Number(r.total_value ?? 0), 0);
  return {
    rfqs: rows,
    quoteCount: rfqs.count ?? rows.length,
    customerCount: customers.count ?? 0,
    activeJobs: jobs.count ?? jobs.data?.length ?? 0,
    pipeline
  };
}
