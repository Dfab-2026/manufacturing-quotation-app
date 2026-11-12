import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/security/auth";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const { supabase, membership } = await requireSession();

    const { data: drawing } = await supabase
      .from("drawings")
      .select("file_name,storage_path,mime_type")
      .eq("tenant_id", membership.tenant_id)
      .eq("id", id)
      .maybeSingle();

    if (!drawing) {
      return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    }

    const { data, error } = await supabase.storage.from("drawings").download(drawing.storage_path);
    if (error || !data) {
      return NextResponse.json({ error: "Unable to open drawing" }, { status: 404 });
    }

    const fileName = drawing.file_name.replace(/[\r\n"\\]/g, "_");
    return new NextResponse(data, {
      status: 200,
      headers: {
        "content-type": drawing.mime_type,
        "content-disposition": `inline; filename="${fileName}"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Invalid drawing request" }, { status: 400 });
  }
}
