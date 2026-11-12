import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppRole = "owner" | "admin" | "estimator" | "viewer" | "sales" | "approver" | "production" | "finance";

export async function requireSession() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id, role, tenants(name, slug)")
    .eq("user_id", data.user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/login?error=no-membership");
  return { supabase, user: data.user, membership };
}

export async function requireRole(roles: AppRole[]) {
  const session = await requireSession();
  if (!roles.includes(session.membership.role as AppRole)) {
    throw new Error("Forbidden");
  }
  return session;
}
