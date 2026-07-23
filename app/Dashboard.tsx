"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentPiece } from "@/lib/content-audit";
import type { AuditDetail, ImportRow, Workflow } from "@/lib/types";

type Mode = "content" | "gsc" | "brain";
type WorkflowSummary = {
  id: string;
  title: string;
  category: string;
  handoffs: string;
  nodeCount: number;
  decisionCount: number;
  terminalCount: number;
};

const GROUPS = ["AEO", "GEO", "TECH", "FRESH"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3", "OK"] as const;

function parseCsv(source: string): ImportRow[] {
  const output: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) output.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) output.push(row);
  if (output.length < 2) throw new Error("The CSV needs a header and at least one row.");
  const headers = output[0].map((header) =>
    header
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, ""),
  );
  return output.slice(1).map((values) => {
    const parsed: ImportRow = {};
    headers.forEach((header, index) => {
      parsed[header] = values[index]?.trim() ?? "";
    });
    if (!parsed.url && parsed.page) parsed.url = parsed.page;
    if (!parsed.reason && parsed.indexing_reason) parsed.reason = parsed.indexing_reason;
    return parsed;
  });
}

function csvValue(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function download(name: string, rows: unknown[][]) {
  const blob = new Blob([rows.map((row) => row.map(csvValue).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  URL.revokeObjectURL(href);
}

export default function Dashboard() {
  const [mode, setMode] = useState<Mode>("content");
  const [pieces, setPieces] = useState<ContentPiece[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [urls, setUrls] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [hideFixed, setHideFixed] = useState(false);
  const [workflowQuery, setWorkflowQuery] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [gscProperty, setGscProperty] = useState("");
  const [gscRows, setGscRows] = useState<ImportRow[]>([]);
  const [gscFile, setGscFile] = useState("");
  const [gscAudit, setGscAudit] = useState<AuditDetail | null>(null);

  const loadPieces = useCallback(async () => {
    const response = await fetch("/api/pieces");
    if (!response.ok) return;
    const data = (await response.json()) as { items: ContentPiece[] };
    setPieces(data.items);
  }, []);

  useEffect(() => {
    void Promise.all([
      loadPieces(),
      fetch("/api/workflows")
        .then((response) => response.json())
        .then((data: { items: WorkflowSummary[] }) => setWorkflows(data.items)),
    ]).catch(() => setError("The workbench could not load its saved data."));
  }, [loadPieces]);

  const runContentAudit = async (selectedUrls?: string[]) => {
    const input = selectedUrls ?? urls.split(/[\n,]+/).map((url) => url.trim()).filter(Boolean);
    if (!input.length) return setError("Paste at least one URL.");
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/pieces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: input }),
      });
      const data = (await response.json()) as { items?: ContentPiece[]; error?: string };
      if (!response.ok || !data.items) throw new Error(data.error || "Audit failed.");
      setPieces((current) => {
        const next = [...current];
        data.items!.forEach((item) => {
          const index = next.findIndex((piece) => piece.url === item.url);
          if (index >= 0) next[index] = item;
          else next.unshift(item);
        });
        return next;
      });
      setUrls("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Audit failed.");
    } finally {
      setRunning(false);
    }
  };

  const updatePiece = async (
    url: string,
    changes: { fixStatus?: ContentPiece["fixStatus"]; owner?: string; note?: string },
  ) => {
    const response = await fetch("/api/pieces", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, ...changes }),
    });
    const data = (await response.json()) as { item?: ContentPiece; error?: string };
    if (!response.ok || !data.item) return setError(data.error || "Update failed.");
    setPieces((current) => current.map((piece) => (piece.url === url ? data.item! : piece)));
  };

  const filteredPieces = useMemo(() => {
    const lowered = query.toLowerCase();
    return pieces.filter((piece) => {
      if (lowered && !`${piece.title} ${piece.url}`.toLowerCase().includes(lowered)) return false;
      if (priority && piece.priority !== priority) return false;
      if (status && piece.fixStatus !== status) return false;
      if (hideFixed && piece.fixStatus === "Fixed") return false;
      return true;
    });
  }, [hideFixed, pieces, priority, query, status]);

  const summary = useMemo(() => {
    const byPriority: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0, OK: 0 };
    let issues = 0;
    let fixed = 0;
    pieces.forEach((piece) => {
      byPriority[piece.priority] += 1;
      issues += piece.issueCount;
      if (piece.fixStatus === "Fixed") fixed += 1;
    });
    return { byPriority, issues, fixed };
  }, [pieces]);

  const runGscAudit = async () => {
    if (!gscProperty.trim() || !gscRows.length) return setError("Add the GSC property and CSV export.");
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ property: gscProperty, fileName: gscFile, rows: gscRows }),
      });
      const data = (await response.json()) as { audit?: AuditDetail; error?: string };
      if (!response.ok || !data.audit) throw new Error(data.error || "GSC audit failed.");
      setGscAudit(data.audit);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GSC audit failed.");
    } finally {
      setRunning(false);
    }
  };

  const openWorkflow = async (id: string) => {
    const response = await fetch(`/api/workflows?id=${encodeURIComponent(id)}`);
    if (response.ok) {
      const data = (await response.json()) as { workflow: Workflow };
      setSelectedWorkflow(data.workflow);
    }
  };

  return (
    <>
      <header className="appHeader">
        <button className="identity" onClick={() => setMode("content")}>
          <span className="logo">✦</span>
          <span><strong>SearchOps Workbench</strong><small>Audit each page. Fix each piece once.</small></span>
        </button>
        <nav>
          <button className={mode === "content" ? "active" : ""} onClick={() => setMode("content")}>Content audit</button>
          <button className={mode === "gsc" ? "active" : ""} onClick={() => setMode("gsc")}>GSC audit</button>
          <button className={mode === "brain" ? "active" : ""} onClick={() => setMode("brain")}>Workflow brain <em>{workflows.length || 46}</em></button>
        </nav>
      </header>

      <main className="workbench">
        {error && <div className="alert"><strong>Action needed</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}

        {mode === "content" && (
          <>
            <section className="auditPanel">
              <div className="panelTitle">
                <div><span>LIVE PAGE AUDIT</span><h1>What content should we inspect?</h1><p>Paste URLs. The workbench fetches the real pages, runs deterministic MASTER_BRAIN checks, and stores one operational row per page.</p></div>
                <span className="engineBadge"><i /> Engine online</span>
              </div>
              <div className="auditInputRow">
                <textarea value={urls} onChange={(event) => setUrls(event.target.value)} placeholder={"Paste one or more URLs — one per line\nhttps://example.com/blog/best-crm\nhttps://example.com/pricing"} />
                <div className="auditSide">
                  <div className="checkSummary"><span>✓ AEO architecture</span><span>✓ GEO/schema</span><span>✓ Technical gates</span><span>✓ Freshness</span></div>
                  <button className="runAudit" onClick={() => void runContentAudit()} disabled={running}>{running ? <><i className="spinner" /> Auditing live pages…</> : <>▶ Run audit</>}</button>
                </div>
              </div>
              <div className="scopeNote"><strong>Transparent by design:</strong> checks use fetched HTML and deterministic rules. JavaScript-rendered content, brand voice, and subjective quality still need human review.</div>
            </section>

            <section className="summary">
              <Stat label="Content pieces" value={pieces.length} />
              <Stat label="Open issues" value={summary.issues} />
              <div className="stat priorityStat"><span>Priority</span><div>{PRIORITIES.slice(0, 4).map((item) => <b className={item.toLowerCase()} key={item}>{item} {summary.byPriority[item]}</b>)}</div></div>
              <Stat label="Fixed" value={`${summary.fixed} / ${pieces.length}`} />
            </section>

            <section className="filters">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or URL…" />
              <select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select>
              <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option>To fix</option><option>In progress</option><option>Fixed</option></select>
              <label><input type="checkbox" checked={hideFixed} onChange={(event) => setHideFixed(event.target.checked)} /> hide fixed</label>
              <span />
              <button className="secondaryButton" disabled={!pieces.length || running} onClick={() => void runContentAudit(pieces.map((piece) => piece.url))}>↻ Re-audit all</button>
            </section>

            <div className="pieceTableWrap">
              {pieces.length ? (
                <table className="pieceTable">
                  <thead><tr><th>Content piece</th><th>Funnel</th>{GROUPS.map((group) => <th key={group}>{group}</th>)}<th>Issues</th><th>Priority</th><th>Status</th><th>Owner</th></tr></thead>
                  <tbody>
                    {filteredPieces.map((piece) => (
                      <PieceRows
                        key={piece.url}
                        piece={piece}
                        open={Boolean(open[piece.url])}
                        onToggle={() => setOpen((current) => ({ ...current, [piece.url]: !current[piece.url] }))}
                        onUpdate={updatePiece}
                        onReaudit={() => void runContentAudit([piece.url])}
                        onWorkflow={openWorkflow}
                      />
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty"><span>◎</span><strong>No content pieces yet</strong><p>Paste URLs above and run the first audit.</p></div>
              )}
            </div>
          </>
        )}

        {mode === "gsc" && (
          <>
            <section className="auditPanel gscPanel">
              <div className="panelTitle"><div><span>GOOGLE SEARCH CONSOLE</span><h1>Import an indexing export</h1><p>Match every row to R1–R27, store the evidence, and return a safe action or the exact context still needed.</p></div></div>
              <div className="gscInputs">
                <label>Search Console property<input value={gscProperty} onChange={(event) => setGscProperty(event.target.value)} placeholder="sc-domain:example.com" /></label>
                <label className="fileInput">GSC CSV export<input type="file" accept=".csv,text/csv" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    const parsed = parseCsv(await file.text());
                    if (!parsed.some((row) => row.url) || !parsed.some((row) => row.reason || row.workflow_id)) throw new Error("CSV needs url + reason columns.");
                    setGscRows(parsed);
                    setGscFile(file.name);
                    setError("");
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : "CSV could not be read.");
                  }
                }} /><span>{gscRows.length ? `${gscFile} · ${gscRows.length} rows ready` : "Choose CSV file"}</span></label>
                <button className="runAudit" disabled={running} onClick={() => void runGscAudit()}>{running ? "Running workflow brain…" : "▶ Run GSC audit"}</button>
              </div>
              <div className="scopeNote">Required columns: <code>url</code> + <code>reason</code>. <a href="/sample-gsc-export.csv" download>Download the working template</a>.</div>
            </section>
            {gscAudit ? (
              <>
                <section className="summary">
                  <Stat label="Rows" value={gscAudit.totalRows} />
                  <Stat label="Resolved" value={gscAudit.evaluatedRows} />
                  <Stat label="Needs context" value={gscAudit.needsContextRows} />
                  <button className="stat exportStat" onClick={() => download("gsc-findings.csv", [
                    ["url", "reason", "workflow", "severity", "status", "suggestion"],
                    ...gscAudit.findings.map((finding) => [finding.url, finding.reason, finding.workflowId, finding.severity, finding.status, finding.suggestion]),
                  ])}><span>Export</span><strong>⇩ CSV</strong></button>
                </section>
                <div className="pieceTableWrap">
                  <table className="pieceTable gscTable"><thead><tr><th>URL</th><th>Reason</th><th>Workflow</th><th>Priority</th><th>Recommended action</th><th>Status</th></tr></thead>
                    <tbody>{gscAudit.findings.map((finding) => <tr key={finding.id}><td><strong>{finding.url}</strong></td><td>{finding.reason}</td><td><button className="workflowChip" onClick={() => void openWorkflow(finding.workflowId)}>{finding.workflowId}</button></td><td><span className={`severity ${finding.severity}`}>{finding.severity}</span></td><td><strong className="suggestionId">{finding.suggestionId}</strong><p>{finding.suggestion}</p>{finding.missingContext.length > 0 && <small>Missing: {finding.missingContext.join(" · ")}</small>}</td><td><span className={`state ${finding.status === "evaluated" ? "done" : "review"}`}>{finding.status === "evaluated" ? "Resolved" : "Review"}</span></td></tr>)}</tbody>
                  </table>
                </div>
              </>
            ) : <div className="empty secondaryEmpty"><span>⇧</span><strong>Your GSC findings will appear here</strong><p>Import the provided sample if you want to test the complete flow.</p></div>}
          </>
        )}

        {mode === "brain" && (
          <>
            <section className="brainHeader"><div><span>MASTER_BRAIN.JSON</span><h1>One inspectable source of truth</h1><p>46 indexing, content, onboarding, and operations workflows. Click any row to inspect its decisions and outcomes.</p></div><strong>{workflows.length || 46}<small>workflows online</small></strong></section>
            <section className="filters brainFilters"><input value={workflowQuery} onChange={(event) => setWorkflowQuery(event.target.value)} placeholder="Search workflow ID, title, category…" /></section>
            <div className="workflowList">{workflows.filter((workflow) => `${workflow.id} ${workflow.title} ${workflow.category}`.toLowerCase().includes(workflowQuery.toLowerCase())).map((workflow) => <button key={workflow.id} onClick={() => void openWorkflow(workflow.id)}><span className="workflowChip">{workflow.id}</span><span><strong>{workflow.title}</strong><small>{workflow.category}</small></span><span>{workflow.decisionCount} decisions</span><span>{workflow.terminalCount} outcomes</span><em>→</em></button>)}</div>
          </>
        )}
      </main>

      {selectedWorkflow && <WorkflowDrawer workflow={selectedWorkflow} onClose={() => setSelectedWorkflow(null)} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function PieceRows({
  piece,
  open,
  onToggle,
  onUpdate,
  onReaudit,
  onWorkflow,
}: {
  piece: ContentPiece;
  open: boolean;
  onToggle: () => void;
  onUpdate: (url: string, changes: { fixStatus?: ContentPiece["fixStatus"]; owner?: string; note?: string }) => Promise<void>;
  onReaudit: () => void;
  onWorkflow: (id: string) => void;
}) {
  const [owner, setOwner] = useState(piece.owner);
  const [note, setNote] = useState("");
  useEffect(() => setOwner(piece.owner), [piece.owner]);
  return (
    <>
      <tr className={`pieceRow ${piece.fixStatus === "Fixed" ? "fixed" : ""}`} onClick={onToggle}>
        <td><strong>{piece.title}</strong><small>{piece.url}</small>{piece.error && <em className="fetchError">Fetch error</em>}</td>
        <td><span className="funnel">{piece.funnel}</span></td>
        {GROUPS.map((group) => {
          const count = piece.groupCounts[group] ?? 0;
          return <td key={group}><span className={`issueCount ${count ? "hit" : "clear"}`}>{count || "✓"}</span></td>;
        })}
        <td><b>{piece.issueCount}</b></td>
        <td><span className={`priority ${piece.priority.toLowerCase()}`}>{piece.priority}</span></td>
        <td onClick={(event) => event.stopPropagation()}><select value={piece.fixStatus} onChange={(event) => void onUpdate(piece.url, { fixStatus: event.target.value as ContentPiece["fixStatus"] })}><option>To fix</option><option>In progress</option><option>Fixed</option></select></td>
        <td>{piece.owner ? <span className="owner" title={piece.owner}>{piece.owner.slice(0, 2).toUpperCase()}</span> : <span className="owner emptyOwner">?</span>}</td>
      </tr>
      {open && (
        <tr className="detailRow">
          <td colSpan={11}>
            <div className="detailGrid">
              <section className="fixPlan">
                <div className="detailHeading"><div><span>CONSOLIDATED FIX PLAN</span><h3>Fix this content piece once</h3></div><b>{piece.consolidatedFixes.length} actions</b></div>
                {piece.error && <div className="inlineAlert">{piece.error}</div>}
                {piece.consolidatedFixes.map((fix) => <div className="fixItem" key={fix.fix}><span className={`severity ${fix.severity}`}>{fix.severity}</span><p>{fix.fix}<small>{fix.discipline} · <button onClick={() => void onWorkflow(fix.workflowId)}>{fix.workflowId}</button>{fix.handoff && ` · handoff ${fix.handoff}`}</small></p></div>)}
                {!piece.consolidatedFixes.length && <div className="cleanPiece">✓ No deterministic issues found.</div>}
              </section>
              <section className="evidence">
                <div className="detailHeading"><div><span>AUDIT EVIDENCE</span><h3>Page signals</h3></div></div>
                <dl><div><dt>HTTP</dt><dd>{piece.statusCode || "—"}</dd></div><div><dt>Words</dt><dd>{piece.wordCount}</dd></div><div><dt>Schema</dt><dd>{piece.schemaTypes.join(", ") || "none"}</dd></div><div><dt>Freshness</dt><dd>{piece.freshnessDate || "not exposed"}</dd></div></dl>
              </section>
            </div>
            <div className="issueGroups">
              {GROUPS.map((group) => {
                const issues = piece.issues.filter((finding) => finding.group === group);
                if (!issues.length) return null;
                return <section key={group}><h4>{group} · {issues.length}</h4>{issues.map((finding) => <div className="issue" key={finding.code}><p><strong>{finding.symptom}</strong><span className="codeChip">CODE</span><button onClick={() => void onWorkflow(finding.workflowId)}>{finding.workflowId}</button></p><small>{finding.rootCause} → <i>{finding.fix}</i></small></div>)}</section>;
              })}
            </div>
            <div className="pieceActions">
              <button className="primarySmall" onClick={() => void onUpdate(piece.url, { fixStatus: "Fixed" })}>✓ Mark fixed</button>
              <button className="secondaryButton" onClick={onReaudit}>↻ Re-audit</button>
              <input value={owner} onChange={(event) => setOwner(event.target.value)} onBlur={() => void onUpdate(piece.url, { owner })} placeholder="Owner" />
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note…" />
              <button className="secondaryButton" onClick={() => { if (note.trim()) void onUpdate(piece.url, { note }).then(() => setNote("")); }}>Add note</button>
            </div>
            {piece.notes.length > 0 && <div className="notes">{piece.notes.map((item) => <p key={item.ts}><span>{new Date(item.ts).toLocaleString()}</span>{item.text}</p>)}</div>}
          </td>
        </tr>
      )}
    </>
  );
}

function WorkflowDrawer({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  return <div className="drawerBackdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={(event) => event.stopPropagation()}><button className="drawerClose" onClick={onClose}>×</button><span className="workflowChip large">{workflow.id}</span><small className="drawerCategory">{workflow.meta.category}</small><h2>{workflow.title}</h2><p>{workflow.structure}</p><div className="drawerStats"><span><strong>{workflow.nodes.length}</strong>nodes</span><span><strong>{workflow.edges.length}</strong>connections</span><span><strong>{workflow.meta.handoffs}</strong>handoffs</span></div><h3>Decision inputs</h3><ul>{workflow.clarifying.map((question) => <li key={question}>{question}</li>)}</ul><h3>Workflow nodes</h3><div className="nodes">{workflow.nodes.map((node) => <div className={node.type} key={node.id}><span>{node.type}</span><p>{node.label.replace(/^SUGGEST:\s*/i, "")}</p></div>)}</div></aside></div>;
}
