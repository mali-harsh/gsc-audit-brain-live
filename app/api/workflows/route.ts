import { NextResponse } from "next/server";
import { workflowById, workflows, workflowSummary } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.toUpperCase();
  if (id) {
    const workflow = workflowById.get(id);
    if (!workflow) return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
    return NextResponse.json({ workflow });
  }

  return NextResponse.json({
    count: workflows.length,
    items: workflows.map(workflowSummary),
  });
}
