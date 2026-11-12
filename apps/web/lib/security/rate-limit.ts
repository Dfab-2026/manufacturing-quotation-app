import type { SupabaseClient } from "@supabase/supabase-js";

export async function enforceRateLimit(
  supabase: SupabaseClient,
  route: string,
  limit: number,
  windowSeconds: number
): Promise<void> {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_route: route,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error || data !== true) {
    const err = new Error("Rate limit exceeded");
    err.name = "RateLimitError";
    throw err;
  }
}
