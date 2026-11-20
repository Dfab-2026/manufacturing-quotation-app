/** Keep every local operation on the same FastAPI service. Never silently
 * write customer drawings, quotations or rates into the deployed database. */
export const DEFAULT_RENDER_API = "https://ai-quotation-api.onrender.com";
export const DEFAULT_LOCAL_API = "http://127.0.0.1:8000";

export function normalizeApiBase(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\/api$/i, "");
}

function isLoopback(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

export function resolveApiRouting(hostname: string, apiValue: string, directValue: string) {
  const api = normalizeApiBase(apiValue);
  const direct = normalizeApiBase(directValue);
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    const primary = [api, direct].find(isLoopback) || DEFAULT_LOCAL_API;
    return { primary, targets: [primary] };
  }
  // Use the configured public backend directly, bypassing Next's legacy
  // http-proxy rewrite. Retain explicit same-origin configurations and the
  // existing direct-first behavior for large uploads in that case.
  const publicApi = api && !isLoopback(api) ? api : "";
  const publicDirect = direct && !isLoopback(direct) ? direct : "";
  const primary = publicApi || publicDirect || DEFAULT_RENDER_API;
  const targets = /^https?:\/\//i.test(primary)
    ? [primary]
    : Array.from(new Set([publicDirect || DEFAULT_RENDER_API, primary]));
  return { primary, targets };
}
