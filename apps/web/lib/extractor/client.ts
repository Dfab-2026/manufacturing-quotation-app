import { createHash, createHmac } from "node:crypto";
import { serverEnv } from "@/lib/env";

type ExtractorResult = {
  drawing_number?: unknown;
  revision?: unknown;
  description?: unknown;
  material?: unknown;
  quantity?: unknown;
  length_mm?: unknown;
  width_mm?: unknown;
  thickness_mm?: unknown;
  diameter_mm?: unknown;
  drawing_weight_kg?: unknown;
  units?: unknown;
  tolerance?: unknown;
  surface_finish?: unknown;
  weld_details?: unknown;
  hole_thread_details?: unknown;
  heat_treatment?: unknown;
  coating?: unknown;
  manufacturing_processes?: unknown[];
  notes?: string[];
  warnings?: string[];
  raw_text?: string;
  [key: string]: unknown;
};

function signatureFor(
  secret: string,
  timestamp: string,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string
) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const canonical = `${timestamp}.${digest}.${fileName}.${mimeType}`;
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export async function analyzeDrawingNow(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}): Promise<ExtractorResult> {
  const env = serverEnv();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signatureFor(
    env.extractorSecret,
    timestamp,
    input.bytes,
    input.fileName,
    input.mimeType
  );

  const form = new FormData();
  form.set(
    "file",
    new Blob([input.bytes], { type: input.mimeType }),
    input.fileName
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 95_000);

  try {
    const response = await fetch(`${env.extractorUrl.replace(/\/$/, "")}/v1/extract`, {
      method: "POST",
      headers: {
        "x-timestamp": timestamp,
        "x-signature": signature
      },
      body: form,
      cache: "no-store",
      signal: controller.signal
    });

    const body = (await response.json().catch(() => null)) as ExtractorResult | { detail?: string } | null;
    if (!response.ok) {
      const detail = body && "detail" in body && typeof body.detail === "string" ? body.detail : "Extractor request failed";
      throw new Error(detail);
    }
    if (!body || !("drawing_number" in body)) {
      throw new Error("Extractor returned an invalid response");
    }
    return body as ExtractorResult;
  } finally {
    clearTimeout(timeout);
  }
}
