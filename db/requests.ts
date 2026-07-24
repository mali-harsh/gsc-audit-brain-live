import { env } from "cloudflare:workers";
import type { ChangeRequest, ChangeRequestStatus } from "@/lib/types";

let schemaReady = false;

function db() {
  if (!env.DB) throw new Error("The DB binding is unavailable.");
  return env.DB;
}

async function ensureSchema() {
  if (schemaReady) return;
  const database = db();
  await database.batch([
    database.prepare(
      `CREATE TABLE IF NOT EXISTS change_requests (
        id TEXT PRIMARY KEY,
        requester TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL,
        page TEXT NOT NULL,
        expected TEXT NOT NULL,
        status TEXT NOT NULL,
        preview_url TEXT NOT NULL,
        branch TEXT NOT NULL,
        owner_note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    database.prepare("CREATE INDEX IF NOT EXISTS change_requests_created_at_idx ON change_requests (created_at)"),
  ]);
  schemaReady = true;
}

type RequestRow = {
  id: string;
  requester: string;
  title: string;
  details: string;
  page: string;
  expected: string;
  status: ChangeRequestStatus;
  preview_url: string;
  branch: string;
  owner_note: string;
  created_at: string;
  updated_at: string;
};

function toRequest(row: RequestRow): ChangeRequest {
  return {
    id: row.id,
    requester: row.requester,
    title: row.title,
    details: row.details,
    page: row.page,
    expected: row.expected,
    status: row.status,
    previewUrl: row.preview_url,
    branch: row.branch,
    ownerNote: row.owner_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRequests() {
  await ensureSchema();
  const result = await db()
    .prepare("SELECT * FROM change_requests ORDER BY created_at DESC")
    .all<RequestRow>();
  return result.results.map(toRequest);
}

export async function createRequest(input: {
  requester: string;
  title: string;
  details: string;
  page?: string;
  expected?: string;
}) {
  await ensureSchema();
  const now = new Date().toISOString();
  const id = `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  await db()
    .prepare(
      `INSERT INTO change_requests (
        id, requester, title, details, page, expected,
        status, preview_url, branch, owner_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Requested', '', '', '', ?, ?)`,
    )
    .bind(id, input.requester, input.title, input.details, input.page ?? "", input.expected ?? "", now, now)
    .run();
  const row = await db().prepare("SELECT * FROM change_requests WHERE id = ?").bind(id).first<RequestRow>();
  return toRequest(row!);
}

export async function updateRequest(
  id: string,
  changes: { status?: ChangeRequestStatus; previewUrl?: string; branch?: string; ownerNote?: string },
) {
  await ensureSchema();
  const database = db();
  const row = await database.prepare("SELECT * FROM change_requests WHERE id = ?").bind(id).first<RequestRow>();
  if (!row) return null;
  const status = changes.status ?? row.status;
  const previewUrl = changes.previewUrl !== undefined ? changes.previewUrl : row.preview_url;
  const branch = changes.branch !== undefined ? changes.branch : row.branch;
  const ownerNote = changes.ownerNote !== undefined ? changes.ownerNote : row.owner_note;
  await database
    .prepare(
      "UPDATE change_requests SET status = ?, preview_url = ?, branch = ?, owner_note = ?, updated_at = ? WHERE id = ?",
    )
    .bind(status, previewUrl, branch, ownerNote, new Date().toISOString(), id)
    .run();
  const updated = await database.prepare("SELECT * FROM change_requests WHERE id = ?").bind(id).first<RequestRow>();
  return updated ? toRequest(updated) : null;
}

export async function deleteRequest(id: string) {
  await ensureSchema();
  await db().prepare("DELETE FROM change_requests WHERE id = ?").bind(id).run();
}
