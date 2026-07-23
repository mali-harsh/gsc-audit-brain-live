export type WorkflowNode = {
  id: string;
  type: "root" | "data" | "action" | "decision" | "terminal" | "handoff";
  label: string;
};

export type WorkflowEdge = {
  from: string;
  to: string;
  cond: string;
};

export type Workflow = {
  id: string;
  title: string;
  meta: {
    category: string;
    status: string;
    handoffs: string;
  };
  clarifying: string[];
  synonyms: string[];
  structure: string;
  changes: string[];
  rationale: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type ImportRow = Record<string, string | number | boolean | null | undefined>;

export type Finding = {
  id?: string;
  rowNumber: number;
  url: string;
  reason: string;
  workflowId: string;
  workflowTitle: string;
  category: string;
  status: "evaluated" | "needs_context" | "needs_mapping";
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  suggestionId: string;
  suggestion: string;
  missingContext: string[];
  raw: ImportRow;
};

export type AuditSummary = {
  id: string;
  property: string;
  fileName: string;
  status: string;
  totalRows: number;
  evaluatedRows: number;
  needsContextRows: number;
  createdAt: string;
};

export type AuditDetail = AuditSummary & {
  findings: Finding[];
};
