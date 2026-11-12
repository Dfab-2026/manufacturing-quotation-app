import { NextRequest } from "next/server";

export function requestId(request: NextRequest): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (new URL(origin).host !== request.nextUrl.host) {
    throw new Error("Cross-origin request rejected");
  }
}
