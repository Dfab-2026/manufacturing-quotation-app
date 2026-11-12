import { NextResponse } from "next/server";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({status:"ok",service:"forgequote-web",timestamp:new Date().toISOString()},{headers:{"cache-control":"no-store"}})}
