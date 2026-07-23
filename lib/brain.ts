import type { Finding, FindingExplanation, ImportRow, Workflow } from "@/lib/types";
import { workflowById } from "@/lib/workflows";

const REASON_TO_ID: Record<string, string> = {
  "server error (5xx)": "R1",
  "redirect error": "R2",
  "url blocked by robots.txt": "R3",
  "blocked by robots.txt": "R3",
  "url marked 'noindex'": "R4",
  "excluded by 'noindex' tag": "R4",
  "soft 404": "R5",
  "blocked due to unauthorized request (401)": "R6",
  "not found (404)": "R7",
  "blocked due to access forbidden (403)": "R8",
  "url blocked due to other 4xx issue": "R9",
  "crawled - currently not indexed": "R10",
  "crawled — currently not indexed": "R10",
  "discovered - currently not indexed": "R11",
  "discovered — currently not indexed": "R11",
  "alternate page with proper canonical tag": "R12",
  "duplicate without user-selected canonical": "R13",
  "duplicate, google chose different canonical than user": "R14",
  "page with redirect": "R15",
  "indexed, though blocked by robots.txt": "R16",
  "page indexed without content": "R17",
  "blocked by page removal tool": "R18",
  "blocked due to legal issue": "R19",
  "excluded by 'noindex' tag (legacy label)": "R20",
  "submitted url not selected as canonical": "R21",
  "submitted url blocked by robots.txt": "R22",
  "submitted url marked 'noindex'": "R23",
  "submitted url seems to be a soft 404": "R24",
  "submitted url returns unauthorized request (401)": "R25",
  "submitted url not found (404)": "R26",
  "submitted url has crawl issue": "R27",
};

const LEGACY_HANDOFFS: Record<string, string> = {
  R20: "R4",
  R21: "R14",
  R22: "R3",
  R23: "R4",
  R24: "R5",
  R25: "R6",
  R26: "R7",
};

function text(row: ImportRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function numberValue(row: ImportRow, ...keys: string[]) {
  const value = Number(text(row, ...keys).replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function booleanValue(row: ImportRow, ...keys: string[]) {
  const value = text(row, ...keys).toLowerCase();
  if (["1", "true", "yes", "y", "in", "included", "indexed"].includes(value)) return true;
  if (["0", "false", "no", "n", "out", "excluded", "not indexed"].includes(value)) return false;
  return null;
}

function daysSince(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function terminal(workflow: Workflow, id: string) {
  const wanted = id.startsWith("t_") ? id : `t_${id}`;
  const node = workflow.nodes.find((candidate) => candidate.id === wanted);
  if (!node) return null;
  return {
    suggestionId: `${workflow.id}.${wanted}`,
    suggestion: node.label.replace(/^SUGGEST:\s*/i, "").trim(),
  };
}

function severityFor(workflow: Workflow) {
  const category = workflow.meta.category.toLowerCase();
  if (category.includes("errors")) return "high" as const;
  if (category.includes("expected")) return "low" as const;
  if (category.includes("warnings")) return "medium" as const;
  return "medium" as const;
}

function normaliseReason(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function classify(row: ImportRow) {
  const explicit = text(row, "workflow_id", "workflow");
  if (explicit && workflowById.has(explicit.toUpperCase())) return explicit.toUpperCase();
  return REASON_TO_ID[normaliseReason(text(row, "reason", "reason_label", "indexing_reason"))] ?? "";
}

function displayValue(value: ImportRow[string]) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "").trim();
}

function evidenceFrom(row: ImportRow) {
  return Object.entries(row)
    .filter(
      ([key, value]) =>
        !["url", "page", "address"].includes(key) &&
        value !== null &&
        value !== undefined &&
        displayValue(value),
    )
    .slice(0, 12)
    .map(([field, value]) => ({ field, value: displayValue(value) }));
}

function pathToNode(workflow: Workflow, targetId: string) {
  const queue: Array<{ nodeId: string; path: Array<{ nodeId: string; condition?: string }> }> = [
    { nodeId: "root", path: [{ nodeId: "root" }] },
  ];
  const visited = new Set<string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    if (current.nodeId === targetId) return current.path;
    for (const edge of workflow.edges.filter((candidate) => candidate.from === current.nodeId)) {
      queue.push({
        nodeId: edge.to,
        path: [...current.path, { nodeId: edge.to, condition: edge.cond }],
      });
    }
  }
  return [];
}

export function explainFinding(
  workflowId: string,
  row: ImportRow,
  suggestionId: string,
  status: Finding["status"],
  suggestion: string,
): FindingExplanation {
  const workflow = workflowById.get(workflowId);
  if (!workflow) {
    return {
      source: "MASTER_BRAIN.json",
      whyError:
        "This Google Search Console reason is not mapped to a workflow in MASTER_BRAIN.json, so the engine stopped instead of guessing.",
      howToFix:
        "Add a supported reason label or workflow_id to the import, then run the audit again.",
      howToVerify: [
        "Confirm the export reason matches a workflow title or synonym in MASTER_BRAIN.json.",
        "Re-import the row and confirm it resolves to a workflow ID instead of UNMAPPED.",
      ],
      evidenceUsed: evidenceFrom(row),
      decisionPath: [],
    };
  }

  const targetId = suggestionId.startsWith(`${workflow.id}.`)
    ? suggestionId.slice(workflow.id.length + 1)
    : "";
  const path = targetId && targetId !== "needs_context" ? pathToNode(workflow, targetId) : [];
  const fallback = workflow.nodes
    .filter((node) => ["root", "data", "action", "decision"].includes(node.type))
    .slice(0, 8)
    .map((node) => ({ nodeId: node.id, condition: undefined as string | undefined }));
  const selectedPath = path.length ? path : fallback;

  return {
    source: "MASTER_BRAIN.json",
    whyError:
      status === "evaluated"
        ? `${workflow.structure} The evidence in this import followed the workflow to “${suggestion}”.`
        : `${workflow.structure} The workflow matched, but MASTER_BRAIN.json requires more evidence before it can choose a safe outcome.`,
    howToFix: suggestion,
    howToVerify: workflow.clarifying.length
      ? workflow.clarifying.slice(0, 4).map((question) => `Confirm: ${question}`)
      : [
          "Re-export or inspect the URL in Google Search Console.",
          "Confirm the original indexing reason is cleared.",
        ],
    evidenceUsed: evidenceFrom(row),
    decisionPath: selectedPath
      .map(({ nodeId, condition }) => {
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
        return node
          ? { nodeId, type: node.type, label: node.label.replace(/^SUGGEST:\s*/i, ""), condition }
          : null;
      })
      .filter((node): node is NonNullable<typeof node> => Boolean(node)),
  };
}

function result(
  workflow: Workflow,
  row: ImportRow,
  rowNumber: number,
  chosen: ReturnType<typeof terminal>,
  severity: Finding["severity"],
  missingContext: string[] = [],
): Finding {
  const reason = text(row, "reason", "reason_label", "indexing_reason") || workflow.title;
  const url = text(row, "url", "page", "address");
  if (!chosen) {
    return {
      rowNumber,
      url,
      reason,
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      category: workflow.meta.category,
      status: "needs_context",
      severity: "unknown",
      suggestionId: `${workflow.id}.needs_context`,
      suggestion:
        "Workflow matched, but the export does not contain enough evidence to select a safe recommendation. Add the missing context shown below and re-run.",
      missingContext: missingContext.length ? missingContext : workflow.clarifying,
      explanation: explainFinding(
        workflow.id,
        row,
        `${workflow.id}.needs_context`,
        "needs_context",
        "Collect the missing context shown below, then re-run this row.",
      ),
      raw: row,
    };
  }

  return {
    rowNumber,
    url,
    reason,
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    category: workflow.meta.category,
    status: "evaluated",
    severity,
    suggestionId: chosen.suggestionId,
    suggestion: chosen.suggestion,
    missingContext: [],
    explanation: explainFinding(workflow.id, row, chosen.suggestionId, "evaluated", chosen.suggestion),
    raw: row,
  };
}

export function evaluateRow(row: ImportRow, rows: ImportRow[], rowNumber: number): Finding {
  const workflowId = classify(row);
  const workflow = workflowById.get(workflowId);
  const reason = text(row, "reason", "reason_label", "indexing_reason");
  const url = text(row, "url", "page", "address");

  if (!workflow) {
    return {
      rowNumber,
      url,
      reason: reason || "Unmapped reason",
      workflowId: "UNMAPPED",
      workflowTitle: "Unmapped export reason",
      category: "Needs mapping",
      status: "needs_mapping",
      severity: "unknown",
      suggestionId: "manual_mapping",
      suggestion: "This export label does not match a workflow in MASTER_BRAIN.json.",
      missingContext: ["Provide a supported reason label or a workflow_id column."],
      explanation: explainFinding(
        "UNMAPPED",
        row,
        "manual_mapping",
        "needs_mapping",
        "Add a supported reason label or workflow_id to the import, then run the audit again.",
      ),
      raw: row,
    };
  }

  const sameReason = rows.filter((candidate) => classify(candidate) === workflow.id);
  const share = sameReason.length / Math.max(rows.length, 1);
  const inSitemap = booleanValue(row, "in_sitemap", "sitemap");
  const hasTraffic = numberValue(row, "clicks") > 0 || numberValue(row, "impressions") > 0;
  const indexed = booleanValue(row, "indexed", "target_indexed");
  const robots = text(row, "robots_txt_state", "robots").toUpperCase();
  const indexing = text(row, "indexing_state").toUpperCase();
  const pattern = text(row, "pattern", "url_pattern").toLowerCase();
  const age = daysSince(text(row, "last_crawl_time", "last_crawled"));
  let chosen: ReturnType<typeof terminal> = null;
  let severity: Finding["severity"] = severityFor(workflow);
  let missing: string[] = [];

  switch (workflow.id) {
    case "R1":
      if (sameReason.length === 1) {
        chosen = terminal(workflow, age !== null && age < 7 ? "single_recent" : "single_old");
      } else if (share >= 0.8) {
        chosen = terminal(workflow, "site");
        severity = "critical";
      } else {
        chosen = terminal(workflow, "cluster");
      }
      break;
    case "R2":
      chosen = terminal(workflow, /https?|www/.test(pattern) ? "flip" : sameReason.length > 1 ? "cluster" : "single");
      break;
    case "R3":
      if (inSitemap === true) {
        chosen = terminal(workflow, "conflict");
        severity = "high";
      } else if (inSitemap === false) {
        chosen = terminal(workflow, "intentional");
        severity = "low";
      } else missing = ["in_sitemap"];
      break;
    case "R4":
      if (inSitemap === false) {
        chosen = terminal(workflow, "intentional");
        severity = "low";
      } else if (inSitemap === true && robots.includes("DISALLOW")) {
        chosen = terminal(workflow, "robots_conflict");
        severity = "high";
      } else if (inSitemap === true && indexing.includes("HTTP")) {
        chosen = terminal(workflow, "header_conflict");
        severity = "high";
      } else if (inSitemap === true) {
        chosen = terminal(workflow, "meta_conflict");
        severity = "high";
      } else missing = ["in_sitemap", "indexing_state"];
      break;
    case "R5":
      if (sameReason.length > 2) chosen = terminal(workflow, "template");
      else if (inSitemap === true && hasTraffic) chosen = terminal(workflow, "valuable");
      else if (inSitemap === true) chosen = terminal(workflow, "gone");
      else if (inSitemap === false) {
        chosen = terminal(workflow, "singleton");
        severity = "low";
      } else missing = ["in_sitemap", "clicks or impressions"];
      break;
    case "R6":
      chosen = terminal(workflow, share >= 0.8 ? "staging" : inSitemap === true ? "conflict" : "subset");
      severity = share >= 0.8 ? "critical" : "high";
      break;
    case "R7": {
      const referring = text(row, "referring_urls", "referring_url");
      if (hasTraffic || referring) chosen = terminal(workflow, "recover");
      else if (inSitemap === true) chosen = terminal(workflow, "sitemap_stale");
      else if (inSitemap === false) {
        chosen = terminal(workflow, "ok");
        severity = "low";
      } else missing = ["in_sitemap", "clicks, impressions, or referring_urls"];
      break;
    }
    case "R8":
      chosen = terminal(workflow, share >= 0.5 ? "sitewide" : inSitemap === true ? "conflict" : "subset");
      severity = share >= 0.5 ? "critical" : "high";
      break;
    case "R9":
      if (inSitemap !== null) chosen = terminal(workflow, inSitemap ? "conflict" : "other");
      else missing = ["in_sitemap"];
      break;
    case "R10":
      if (age === null) missing = ["last_crawl_time"];
      else if (age < 14) {
        chosen = terminal(workflow, "wait");
        severity = "low";
      } else if (age <= 90) {
        chosen = terminal(workflow, share > 0.2 ? "site" : "perurl");
        severity = share > 0.2 ? "high" : "medium";
      } else chosen = terminal(workflow, "stale");
      break;
    case "R11": {
      const host = text(row, "host_status", "crawl_stats").toLowerCase();
      const ttfb = numberValue(row, "ttfb_ms");
      if (host.includes("slow") || ttfb > 1000) chosen = terminal(workflow, "perf");
      else if (pattern.includes("facet") || pattern.includes("param") || url.includes("?")) chosen = terminal(workflow, "bloat");
      else if (numberValue(row, "site_url_count") > 0 && numberValue(row, "site_url_count") < 10_000)
        chosen = terminal(workflow, "authority");
      else missing = ["host_status or ttfb_ms", "pattern", "site_url_count"];
      break;
    }
    case "R12": {
      const targetIndexed = booleanValue(row, "target_indexed", "canonical_indexed");
      const hreflang = booleanValue(row, "hreflang_variant");
      if (targetIndexed === false) chosen = terminal(workflow, "target_gap");
      else if (hreflang === true) chosen = terminal(workflow, "hreflang");
      else if (targetIndexed === true && hreflang === false) {
        chosen = terminal(workflow, "ok");
        severity = "low";
      } else missing = ["target_indexed", "hreflang_variant"];
      break;
    }
    case "R13":
      if (url.includes("?") || pattern.includes("param")) chosen = terminal(workflow, "params");
      else if (/https?|www/.test(pattern)) chosen = terminal(workflow, "proto");
      else if (pattern.includes("slash")) chosen = terminal(workflow, "slash");
      else if (pattern.includes("case")) chosen = terminal(workflow, "case");
      else if (booleanValue(row, "should_be_distinct") === true) chosen = terminal(workflow, "distinct");
      else missing = ["pattern or should_be_distinct"];
      break;
    case "R14": {
      const signal = text(row, "canonical_signal", "canonical_diagnosis").toLowerCase();
      if (signal.includes("conflict")) chosen = terminal(workflow, "conflict");
      else if (signal.includes("authority") || signal.includes("strength")) chosen = terminal(workflow, "strength");
      else if (signal.includes("hreflang")) chosen = terminal(workflow, "hreflang");
      else if (signal.includes("dissimilar") || signal.includes("content")) chosen = terminal(workflow, "similar");
      else missing = ["canonical_signal"];
      break;
    }
    case "R15": {
      const targetIndexed = booleanValue(row, "target_indexed", "redirect_target_indexed");
      if (inSitemap === true) chosen = terminal(workflow, "sitemap");
      else if (inSitemap === false && targetIndexed === false) chosen = terminal(workflow, "target_gap");
      else if (inSitemap === false && targetIndexed === true) {
        chosen = terminal(workflow, "ok");
        severity = "low";
      } else missing = ["in_sitemap", "target_indexed"];
      break;
    }
    case "R16": {
      const sensitive = booleanValue(row, "sensitive_content", "urgent_removal");
      const intent = text(row, "search_intent", "indexing_intent").toLowerCase();
      if (sensitive === true) chosen = terminal(workflow, "urgent");
      else if (intent.includes("out") || intent.includes("remove")) chosen = terminal(workflow, "remove");
      else if (intent.includes("in") || intent.includes("keep")) chosen = terminal(workflow, "keep");
      else missing = ["indexing_intent", "sensitive_content"];
      break;
    }
    case "R17": {
      const render = text(row, "render_state", "content_state").toLowerCase();
      if (render.includes("raw has") || render.includes("rendered empty")) chosen = terminal(workflow, "render");
      else if (render.includes("different") || render.includes("cloak")) chosen = terminal(workflow, "cloak");
      else if (render.includes("both empty") || render === "empty") chosen = terminal(workflow, "empty");
      else if (render.includes("format") || render.includes("image") || render.includes("iframe"))
        chosen = terminal(workflow, "format");
      else missing = ["render_state"];
      break;
    }
    case "R18": {
      const intent = text(row, "removal_intent", "indexing_intent").toLowerCase();
      if (intent.includes("bring back") || intent.includes("cancel") || intent.includes("unintended"))
        chosen = terminal(workflow, "cancel");
      else if (intent.includes("keep out") || intent.includes("intended")) {
        chosen = terminal(workflow, "wait");
        severity = "low";
      } else missing = ["removal_intent"];
      break;
    }
    case "R19": {
      const owner = booleanValue(row, "rightful_owner");
      const docs = booleanValue(row, "legal_documentation");
      if (owner === true && docs === true) chosen = terminal(workflow, "counter");
      else if (owner === false || docs === false) chosen = terminal(workflow, "leave");
      else missing = ["rightful_owner", "legal_documentation"];
      break;
    }
    case "R20":
      chosen = {
        suggestionId: "R20.handoff_R4",
        suggestion: "Legacy label matched. Continue with the R4 noindex workflow using the sitemap and noindex-source fields.",
      };
      break;
    case "R21":
    case "R22":
    case "R23":
    case "R24":
    case "R25":
    case "R26": {
      const shouldIndex = booleanValue(row, "should_index", "indexing_intent");
      const generated = booleanValue(row, "auto_generated_sitemap");
      if (shouldIndex === true) {
        const handoff = LEGACY_HANDOFFS[workflow.id];
        chosen = {
          suggestionId: `${workflow.id}.handoff_${handoff}`,
          suggestion: `The sitemap confirms indexing intent. Continue with workflow ${handoff} for the underlying issue.`,
        };
      } else if (shouldIndex === false && generated === true) chosen = terminal(workflow, "bug");
      else if (shouldIndex === false && generated === false) chosen = terminal(workflow, "remove");
      else missing = ["should_index", "auto_generated_sitemap"];
      break;
    }
    case "R27": {
      const state = text(row, "page_fetch_state", "pagefetchstate").toUpperCase();
      const handoff: Record<string, string> = {
        SERVER_ERROR: "R1",
        REDIRECT_ERROR: "R2",
        NOT_FOUND: "R7",
        BLOCKED_4XX: "R9",
      };
      if (handoff[state]) {
        chosen = {
          suggestionId: `R27.handoff_${handoff[state]}`,
          suggestion: `URL Inspection identified ${state}. Continue with workflow ${handoff[state]}.`,
        };
      } else if (booleanValue(row, "transient") === true) chosen = terminal(workflow, "transient");
      else missing = ["page_fetch_state or transient"];
      break;
    }
    default:
      missing = workflow.clarifying;
  }

  return result(workflow, row, rowNumber, chosen, severity, missing);
}

export function evaluateRows(rows: ImportRow[]) {
  return rows.map((row, index) => evaluateRow(row, rows, index + 1));
}
