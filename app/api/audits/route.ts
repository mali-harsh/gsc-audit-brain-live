import { NextResponse } from "next/server";
import { listAudits, saveAudit } from "@/db/audits";
import { evaluateRows } from "@/lib/brain";
import type { ImportRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ items: await listAudits() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Audit history is temporarily unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      property?: string;
      fileName?: string;
      rows?: ImportRow[];
    };
    const property = payload.property?.trim() ?? "";
    const fileName = payload.fileName?.trim() || "gsc-export.csv";
    const rows = payload.rows;

    if (!property) {
      return NextResponse.json({ error: "Enter the GSC property before running the audit." }, { status: 400 });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "The CSV has no data rows." }, { status: 400 });
    }
    if (rows.length > 2_000) {
      return NextResponse.json(
        { error: "This build accepts up to 2,000 rows per audit. Split larger exports into batches." },
        { status: 400 },
      );
    }
    if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      return NextResponse.json({ error: "The imported CSV rows are invalid." }, { status: 400 });
    }

    const findings = evaluateRows(rows);
    const audit = await saveAudit(property, fileName.slice(0, 180), findings);
    return NextResponse.json({ audit }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The audit could not be completed. Please retry." }, { status: 500 });
  }
}
