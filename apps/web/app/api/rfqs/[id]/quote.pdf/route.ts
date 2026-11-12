import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { requireSession } from "@/lib/security/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const idSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const rfqId = idSchema.parse(id);
  const { supabase, membership } = await requireSession();
  await enforceRateLimit(supabase, "GET:/api/rfqs/:id/quote.pdf", 20, 60);

  const { data: rfq } = await supabase
    .from("rfqs")
    .select(
      "id,quote_number,title,currency,total_value,required_date,customer_reference,created_at,tax_percent,freight_amount,validity_days,customers(name,email,phone,gstin,payment_terms)"
    )
    .eq("tenant_id", membership.tenant_id)
    .eq("id", rfqId)
    .maybeSingle();

  if (!rfq) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }

  const [{ data: parts }, { data: tenant }] = await Promise.all([supabase
    .from("parts")
    .select("id,drawing_number,revision,description,quantity")
    .eq("tenant_id", membership.tenant_id)
    .eq("rfq_id", rfqId)
    .order("created_at"), supabase.from("tenants").select("name,legal_name,tax_id,quote_terms,address").eq("id", membership.tenant_id).single()]);

  const customer = rfq.customers as unknown as {
    name?: string;
    email?: string | null;
    phone?: string | null;
    gstin?: string | null;
    payment_terms?: string | null;
  } | null;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const left = 46;
  let y = height - 52;

  const text = (
    value: string,
    size = 10,
    x = left,
    font = regular
  ) => {
    page.drawText(value.slice(0, 100), {
      x,
      y,
      size,
      font,
      color: rgb(0.08, 0.12, 0.18)
    });
  };

  page.drawRectangle({
    x: 0,
    y: height - 102,
    width,
    height: 102,
    color: rgb(0.04, 0.23, 0.34)
  });
  page.drawText(tenant?.legal_name ?? tenant?.name ?? "QUOTATION", {
    x: left, y: height - 42, size: 10, font: bold, color: rgb(0.72,0.86,0.92)
  });
  page.drawText("QUOTATION", {
    x: left,
    y: height - 62,
    size: 24,
    font: bold,
    color: rgb(1, 1, 1)
  });
  page.drawText(rfq.quote_number ?? rfq.id.slice(0, 8).toUpperCase(), {
    x: width - 210,
    y: height - 61,
    size: 12,
    font: bold,
    color: rgb(1, 1, 1)
  });

  y = height - 136;
  text("Customer", 9, left, bold);
  y -= 17;
  text(customer?.name ?? "Unassigned customer", 13, left, bold);
  y -= 15;
  text(customer?.email ?? "", 9);
  y -= 13;
  text(customer?.phone ?? "", 9);
  y -= 13;
  text(customer?.gstin ? `Tax ID: ${customer.gstin}` : "", 9);

  y = height - 136;
  const right = 355;
  text("Quotation date", 9, right, bold);
  y -= 17;
  text(new Date(rfq.created_at).toLocaleDateString("en-IN"), 10, right);
  y -= 22;
  text("Customer reference", 9, right, bold);
  y -= 17;
  text(rfq.customer_reference ?? "—", 10, right);
  y -= 22;
  text("Required date", 9, right, bold);
  y -= 17;
  text(
    rfq.required_date
      ? new Date(rfq.required_date).toLocaleDateString("en-IN")
      : "—",
    10,
    right
  );

  y = height - 286;
  page.drawLine({
    start: { x: left, y },
    end: { x: width - left, y },
    thickness: 1,
    color: rgb(0.86, 0.88, 0.91)
  });
  y -= 28;
  text("Description", 9, left, bold);
  text("Qty", 9, 430, bold);
  text("Revision", 9, 485, bold);
  y -= 14;
  page.drawLine({
    start: { x: left, y },
    end: { x: width - left, y },
    thickness: 1,
    color: rgb(0.9, 0.91, 0.93)
  });

  const rows = (parts ?? []).length
    ? parts ?? []
    : [{
        id: rfq.id,
        drawing_number: null,
        revision: null,
        description: rfq.title,
        quantity: 1
      }];

  for (const part of rows.slice(0, 14)) {
    y -= 27;
    const description = part.drawing_number
      ? `${part.drawing_number} · ${part.description}`
      : part.description;
    text(description, 9);
    text(String(Number(part.quantity)), 9, 430);
    text(part.revision ?? "—", 9, 485);
    y -= 10;
    page.drawLine({
      start: { x: left, y },
      end: { x: width - left, y },
      thickness: 0.5,
      color: rgb(0.93, 0.94, 0.95)
    });
  }

  y = Math.max(145, y - 46);
  const subtotal = Number(rfq.total_value ?? 0);
  const freight = Number(rfq.freight_amount ?? 0);
  const tax = (subtotal + freight) * Number(rfq.tax_percent ?? 0) / 100;
  const amount = subtotal + freight + tax;
  const formatted = `${rfq.currency} ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  page.drawRectangle({
    x: 335,
    y: y - 28,
    width: 214,
    height: 56,
    color: rgb(0.95, 0.97, 0.98)
  });
  page.drawText("Grand total incl. tax/freight", {
    x: 348,
    y: y + 8,
    size: 9,
    font: bold,
    color: rgb(0.28, 0.32, 0.39)
  });
  page.drawText(formatted, {
    x: 348,
    y: y - 14,
    size: 15,
    font: bold,
    color: rgb(0.04, 0.23, 0.34)
  });

  page.drawText(`Subtotal: ${rfq.currency} ${subtotal.toLocaleString("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2})}  |  Freight: ${rfq.currency} ${freight.toLocaleString("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2})}  |  Tax: ${Number(rfq.tax_percent ?? 0)}%`, { x: left, y: 144, size: 7, font: regular, color: rgb(0.38,0.42,0.48) });
  page.drawText(`Validity: ${rfq.validity_days ?? 30} days`, { x: left, y: 132, size: 8, font: regular, color: rgb(0.38,0.42,0.48) });
  page.drawText(`Payment: ${customer?.payment_terms ?? "As agreed"}`, { x: left, y: 120, size: 8, font: regular, color: rgb(0.38,0.42,0.48) });
  page.drawText("Commercial notes", {
    x: left,
    y: 102,
    size: 9,
    font: bold,
    color: rgb(0.28, 0.32, 0.39)
  });
  page.drawText(
    "Prices are subject to the approved quotation terms, taxes, delivery and validity configured by the issuing company.",
    { x: left, y: 84, size: 8, font: regular, color: rgb(0.38, 0.42, 0.48) }
  );
  if (tenant?.quote_terms) page.drawText(String(tenant.quote_terms).slice(0, 115), { x:left, y:72, size:7, font:regular, color:rgb(0.38,0.42,0.48) });

  const bytes = await pdf.save();
  const fileName = `${rfq.quote_number ?? "quotation"}.pdf`.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  return new NextResponse(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
