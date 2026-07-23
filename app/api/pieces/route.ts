import { NextResponse } from "next/server";
import { auditContentUrl } from "@/lib/content-audit";
import { clearPieces, deletePiece, listPieces, storePiece, updatePiece } from "@/db/pieces";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ items: await listPieces() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Saved content audits could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { urls?: string[] };
    const urls = [...new Set((body.urls ?? []).map((url) => url.trim()).filter(Boolean))];
    if (!urls.length) return NextResponse.json({ error: "Paste at least one URL." }, { status: 400 });
    if (urls.length > 10) return NextResponse.json({ error: "Audit up to 10 URLs at a time." }, { status: 400 });

    const items = [];
    for (const url of urls) items.push(await storePiece(await auditContentUrl(url)));
    return NextResponse.json({ items }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The pages could not be audited." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: string;
      fixStatus?: "To fix" | "In progress" | "Fixed";
      owner?: string;
      note?: string;
    };
    if (!body.url) return NextResponse.json({ error: "URL is required." }, { status: 400 });
    if (body.fixStatus && !["To fix", "In progress", "Fixed"].includes(body.fixStatus)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    const item = await updatePiece(body.url, body);
    if (!item) return NextResponse.json({ error: "Content piece not found." }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The content piece could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { url?: string; all?: boolean };
    if (body.all) await clearPieces();
    else if (body.url) await deletePiece(body.url);
    else return NextResponse.json({ error: "Choose a page to remove." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The content could not be removed." }, { status: 500 });
  }
}
