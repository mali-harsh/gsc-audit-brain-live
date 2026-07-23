import { env } from "cloudflare:workers";
import type { ContentPiece } from "@/lib/content-audit";

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
      `CREATE TABLE IF NOT EXISTS content_pieces (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        final_url TEXT NOT NULL,
        title TEXT NOT NULL,
        funnel TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        schema_types_json TEXT NOT NULL,
        freshness_date TEXT,
        audited_at TEXT NOT NULL,
        issues_json TEXT NOT NULL,
        issue_count INTEGER NOT NULL,
        group_counts_json TEXT NOT NULL,
        priority TEXT NOT NULL,
        consolidated_fixes_json TEXT NOT NULL,
        fix_status TEXT NOT NULL,
        owner TEXT NOT NULL,
        notes_json TEXT NOT NULL,
        history_json TEXT NOT NULL,
        error TEXT
      )`,
    ),
    database.prepare("CREATE INDEX IF NOT EXISTS content_pieces_audited_at_idx ON content_pieces (audited_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS content_pieces_priority_idx ON content_pieces (priority)"),
  ]);
  schemaReady = true;
}

type PieceRow = {
  id: string;
  url: string;
  final_url: string;
  title: string;
  funnel: ContentPiece["funnel"];
  status_code: number;
  word_count: number;
  schema_types_json: string;
  freshness_date: string | null;
  audited_at: string;
  issues_json: string;
  issue_count: number;
  group_counts_json: string;
  priority: ContentPiece["priority"];
  consolidated_fixes_json: string;
  fix_status: ContentPiece["fixStatus"];
  owner: string;
  notes_json: string;
  history_json: string;
  error: string | null;
};

function toPiece(row: PieceRow): ContentPiece {
  return {
    id: row.id,
    url: row.url,
    finalUrl: row.final_url,
    title: row.title,
    funnel: row.funnel,
    statusCode: row.status_code,
    wordCount: row.word_count,
    schemaTypes: JSON.parse(row.schema_types_json),
    freshnessDate: row.freshness_date,
    auditedAt: row.audited_at,
    issues: JSON.parse(row.issues_json),
    issueCount: row.issue_count,
    groupCounts: JSON.parse(row.group_counts_json),
    priority: row.priority,
    consolidatedFixes: JSON.parse(row.consolidated_fixes_json),
    fixStatus: row.fix_status,
    owner: row.owner,
    notes: JSON.parse(row.notes_json),
    history: JSON.parse(row.history_json),
    ...(row.error ? { error: row.error } : {}),
  };
}

export async function listPieces() {
  await ensureSchema();
  const result = await db().prepare("SELECT * FROM content_pieces ORDER BY audited_at DESC").all<PieceRow>();
  return result.results.map(toPiece);
}

export async function savePiece(incoming: ContentPiece) {
  await ensureSchema();
  const database = db();
  const previous = await database.prepare("SELECT * FROM content_pieces WHERE url = ?").bind(incoming.url).first<PieceRow>();
  const id = previous?.id ?? `piece_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const fixStatus = previous?.fix_status ?? "To fix";
  const owner = previous?.owner ?? "";
  const notes = previous ? (JSON.parse(previous.notes_json) as ContentPiece["notes"]) : [];
  const history = previous ? (JSON.parse(previous.history_json) as ContentPiece["history"]) : [];
  history.push({
    ts: new Date().toISOString(),
    event: "audited",
    priority: incoming.priority,
    issues: incoming.issueCount,
  });

  await database
    .prepare(
      `INSERT OR REPLACE INTO content_pieces (
        id, url, final_url, title, funnel, status_code, word_count,
        schema_types_json, freshness_date, audited_at, issues_json, issue_count,
        group_counts_json, priority, consolidated_fixes_json, fix_status, owner,
        notes_json, history_json, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      incoming.url,
      incoming.finalUrl,
      incoming.title,
      incoming.funnel,
      incoming.statusCode,
      incoming.wordCount,
      JSON.stringify(incoming.schemaTypes),
      incoming.freshnessDate,
      incoming.auditedAt,
      JSON.stringify(incoming.issues),
      incoming.issueCount,
      JSON.stringify(incoming.groupCounts),
      incoming.priority,
      JSON.stringify(incoming.consolidatedFixes),
      fixStatus,
      owner,
      JSON.stringify(notes),
      JSON.stringify(history.slice(-50)),
      incoming.error ?? null,
    )
    .run();

  return (await database.prepare("SELECT * FROM content_pieces WHERE id = ?").bind(id).first<PieceRow>())!;
}

export async function updatePiece(
  url: string,
  changes: { fixStatus?: ContentPiece["fixStatus"]; owner?: string; note?: string },
) {
  await ensureSchema();
  const database = db();
  const row = await database.prepare("SELECT * FROM content_pieces WHERE url = ?").bind(url).first<PieceRow>();
  if (!row) return null;
  const history = JSON.parse(row.history_json) as ContentPiece["history"];
  const notes = JSON.parse(row.notes_json) as ContentPiece["notes"];
  let fixStatus = row.fix_status;
  let owner = row.owner;
  const now = new Date().toISOString();

  if (changes.fixStatus && changes.fixStatus !== fixStatus) {
    history.push({ ts: now, event: "status", from: fixStatus, to: changes.fixStatus });
    fixStatus = changes.fixStatus;
  }
  if (changes.owner !== undefined && changes.owner !== owner) {
    owner = changes.owner.slice(0, 80);
    history.push({ ts: now, event: "owner", to: owner });
  }
  if (changes.note?.trim()) notes.push({ ts: now, text: changes.note.trim().slice(0, 500) });

  await database
    .prepare(
      "UPDATE content_pieces SET fix_status = ?, owner = ?, notes_json = ?, history_json = ? WHERE url = ?",
    )
    .bind(fixStatus, owner, JSON.stringify(notes.slice(-100)), JSON.stringify(history.slice(-50)), url)
    .run();

  const updated = await database.prepare("SELECT * FROM content_pieces WHERE url = ?").bind(url).first<PieceRow>();
  return updated ? toPiece(updated) : null;
}

export async function storePiece(piece: ContentPiece) {
  const row = await savePiece(piece);
  return toPiece(row);
}
