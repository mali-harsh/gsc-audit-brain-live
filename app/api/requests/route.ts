import { NextResponse } from "next/server";
import { createRequest, deleteRequest, listRequests, updateRequest } from "@/db/requests";
import type { ChangeRequestStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: ChangeRequestStatus[] = ["Requested", "In progress", "Preview ready", "Done", "Declined"];

export async function GET() {
  try {
    return NextResponse.json({ items: await listRequests() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Change requests could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      requester?: string;
      title?: string;
      details?: string;
      page?: string;
      expected?: string;
    };
    const requester = body.requester?.trim();
    const title = body.title?.trim();
    const details = body.details?.trim();
    if (!requester) return NextResponse.json({ error: "Add your name so we know who asked." }, { status: 400 });
    if (!title) return NextResponse.json({ error: "Add a short title for the change." }, { status: 400 });
    if (!details) return NextResponse.json({ error: "Describe what should change." }, { status: 400 });

    const item = await createRequest({
      requester: requester.slice(0, 80),
      title: title.slice(0, 140),
      details: details.slice(0, 2000),
      page: body.page?.trim().slice(0, 200),
      expected: body.expected?.trim().slice(0, 1000),
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The request could not be saved." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      status?: string;
      previewUrl?: string;
      branch?: string;
      ownerNote?: string;
    };
    if (!body.id) return NextResponse.json({ error: "Request id is required." }, { status: 400 });
    if (body.status && !STATUSES.includes(body.status as ChangeRequestStatus)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    const item = await updateRequest(body.id, {
      status: body.status as ChangeRequestStatus | undefined,
      previewUrl: body.previewUrl?.trim(),
      branch: body.branch?.trim(),
      ownerNote: body.ownerNote?.slice(0, 500),
    });
    if (!item) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The request could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { id?: string };
    if (!body.id) return NextResponse.json({ error: "Request id is required." }, { status: 400 });
    await deleteRequest(body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The request could not be removed." }, { status: 500 });
  }
}
