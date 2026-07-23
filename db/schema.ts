import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const audits = sqliteTable(
  "audits",
  {
    id: text("id").primaryKey(),
    property: text("property").notNull(),
    fileName: text("file_name").notNull(),
    status: text("status").notNull(),
    totalRows: integer("total_rows").notNull(),
    evaluatedRows: integer("evaluated_rows").notNull(),
    needsContextRows: integer("needs_context_rows").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audits_created_at_idx").on(table.createdAt)],
);

export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    url: text("url").notNull(),
    reason: text("reason").notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowTitle: text("workflow_title").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull(),
    severity: text("severity").notNull(),
    suggestionId: text("suggestion_id").notNull(),
    suggestion: text("suggestion").notNull(),
    missingContextJson: text("missing_context_json").notNull(),
    rawJson: text("raw_json").notNull(),
  },
  (table) => [
    index("findings_audit_id_idx").on(table.auditId),
    index("findings_workflow_id_idx").on(table.workflowId),
  ],
);

export const contentPieces = sqliteTable(
  "content_pieces",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull().unique(),
    finalUrl: text("final_url").notNull(),
    title: text("title").notNull(),
    funnel: text("funnel").notNull(),
    statusCode: integer("status_code").notNull(),
    wordCount: integer("word_count").notNull(),
    schemaTypesJson: text("schema_types_json").notNull(),
    freshnessDate: text("freshness_date"),
    auditedAt: text("audited_at").notNull(),
    issuesJson: text("issues_json").notNull(),
    issueCount: integer("issue_count").notNull(),
    groupCountsJson: text("group_counts_json").notNull(),
    priority: text("priority").notNull(),
    consolidatedFixesJson: text("consolidated_fixes_json").notNull(),
    fixStatus: text("fix_status").notNull(),
    owner: text("owner").notNull(),
    notesJson: text("notes_json").notNull(),
    historyJson: text("history_json").notNull(),
    error: text("error"),
  },
  (table) => [
    index("content_pieces_audited_at_idx").on(table.auditedAt),
    index("content_pieces_priority_idx").on(table.priority),
  ],
);
