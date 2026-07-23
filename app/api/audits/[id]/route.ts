import { NextResponse } from "next/server";
import { getAudit } from "@/db/audits";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const audit = await getAudit(id);
    if (!audit) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
    return NextResponse.json({ audit });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The audit could not be loaded." }, { status: 500 });
  }
}
