import { env } from "cloudflare:workers";
import type { AuditDetail, AuditSummary, Finding } from "@/lib/types";
import { explainFinding } from "@/lib/brain";

let schemaReady = false;

function db() {
  if (!env.DB) throw new Error("The DB binding is unavailable.");
  return env.DB;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const database = db();
  await database.batch([
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS audits (
          id TEXT PRIMARY KEY,
          property TEXT NOT NULL,
          file_name TEXT NOT NULL,
          status TEXT NOT NULL,
          total_rows INTEGER NOT NULL,
          evaluated_rows INTEGER NOT NULL,
          needs_context_rows INTEGER NOT NULL,
          created_at TEXT NOT NULL
        )`,
      ),
    database.prepare("CREATE INDEX IF NOT EXISTS audits_created_at_idx ON audits (created_at)"),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS findings (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          row_number INTEGER NOT NULL,
          url TEXT NOT NULL,
          reason TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          workflow_title TEXT NOT NULL,
          category TEXT NOT NULL,
          status TEXT NOT NULL,
          severity TEXT NOT NULL,
          suggestion_id TEXT NOT NULL,
          suggestion TEXT NOT NULL,
          missing_context_json TEXT NOT NULL,
          raw_json TEXT NOT NULL,
          FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
        )`,
      ),
    database.prepare("CREATE INDEX IF NOT EXISTS findings_audit_id_idx ON findings (audit_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS findings_workflow_id_idx ON findings (workflow_id)"),
  ]);
  schemaReady = true;
}

type AuditRow = {
  id: string;
  property: string;
  file_name: string;
  status: string;
  total_rows: number;
  evaluated_rows: number;
  needs_context_rows: number;
  created_at: string;
};

function toSummary(row: AuditRow): AuditSummary {
  return {
    id: row.id,
    property: row.property,
    fileName: row.file_name,
    status: row.status,
    totalRows: row.total_rows,
    evaluatedRows: row.evaluated_rows,
    needsContextRows: row.needs_context_rows,
    createdAt: row.created_at,
  };
}

export async function listAudits(limit = 20) {
  await ensureSchema();
  const result = await db()
    .prepare(
      `SELECT id, property, file_name, status, total_rows, evaluated_rows,
        needs_context_rows, created_at
       FROM audits ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<AuditRow>();
  return result.results.map(toSummary);
}

export async function saveAudit(property: string, fileName: string, findings: Finding[]) {
  await ensureSchema();
  const database = db();
  const id = `aud_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const createdAt = new Date().toISOString();
  const evaluatedRows = findings.filter((finding) => finding.status === "evaluated").length;
  const needsContextRows = findings.length - evaluatedRows;
  const statements = [
    database
      .prepare(
        `INSERT INTO audits (
          id, property, file_name, status, total_rows, evaluated_rows,
          needs_context_rows, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        property,
        fileName,
        "completed",
        findings.length,
        evaluatedRows,
        needsContextRows,
        createdAt,
      ),
    ...findings.map((finding) =>
      database
        .prepare(
          `INSERT INTO findings (
            id, audit_id, row_number, url, reason, workflow_id, workflow_title,
            category, status, severity, suggestion_id, suggestion,
            missing_context_json, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `fnd_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
          id,
          finding.rowNumber,
          finding.url,
          finding.reason,
          finding.workflowId,
          finding.workflowTitle,
          finding.category,
          finding.status,
          finding.severity,
          finding.suggestionId,
          finding.suggestion,
          JSON.stringify(finding.missingContext),
          JSON.stringify(finding.raw),
        ),
    ),
  ];

  for (let index = 0; index < statements.length; index += 75) {
    await database.batch(statements.slice(index, index + 75));
  }
  return getAudit(id);
}

type FindingRow = {
  id: string;
  row_number: number;
  url: string;
  reason: string;
  workflow_id: string;
  workflow_title: string;
  category: string;
  status: Finding["status"];
  severity: Finding["severity"];
  suggestion_id: string;
  suggestion: string;
  missing_context_json: string;
  raw_json: string;
};

export async function getAudit(id: string): Promise<AuditDetail | null> {
  await ensureSchema();
  const audit = await db()
    .prepare(
      `SELECT id, property, file_name, status, total_rows, evaluated_rows,
        needs_context_rows, created_at FROM audits WHERE id = ?`,
    )
    .bind(id)
    .first<AuditRow>();
  if (!audit) return null;

  const rows = await db()
    .prepare(
      `SELECT id, row_number, url, reason, workflow_id, workflow_title, category,
        status, severity, suggestion_id, suggestion, missing_context_json, raw_json
       FROM findings WHERE audit_id = ? ORDER BY row_number ASC`,
    )
    .bind(id)
    .all<FindingRow>();

  return {
    ...toSummary(audit),
    findings: rows.results.map((row) => {
      const raw = JSON.parse(row.raw_json);
      return {
        id: row.id,
        rowNumber: row.row_number,
        url: row.url,
        reason: row.reason,
        workflowId: row.workflow_id,
        workflowTitle: row.workflow_title,
        category: row.category,
        status: row.status,
        severity: row.severity,
        suggestionId: row.suggestion_id,
        suggestion: row.suggestion,
        missingContext: JSON.parse(row.missing_context_json) as string[],
        explanation: explainFinding(
          row.workflow_id,
          raw,
          row.suggestion_id,
          row.status,
          row.suggestion,
        ),
        raw,
      };
    }),
  };
}
