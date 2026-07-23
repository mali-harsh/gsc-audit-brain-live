"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentPiece } from "@/lib/content-audit";
import type { AuditDetail, Finding, ImportRow, Workflow } from "@/lib/types";

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
const GUIDED_GSC_DEMO: ImportRow[] = [
  { url: "https://example.com/server-error", reason: "Server error (5xx)", last_crawl_time: "2026-07-20T10:00:00Z", in_sitemap: "yes" },
  { url: "https://example.com/private", reason: "URL marked 'noindex'", indexing_state: "BLOCKED_BY_META_TAG", robots_txt_state: "ALLOWED", in_sitemap: "yes" },
  { url: "https://example.com/deleted", reason: "Not found (404)", clicks: "23", impressions: "120", in_sitemap: "yes" },
  { url: "https://example.com/quality", reason: "Crawled - currently not indexed", last_crawl_time: "2026-04-01T10:00:00Z", in_sitemap: "yes" },
];

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
  const [site, setSite] = useState("");
  const [maxPages, setMaxPages] = useState(50);
  const [discoveredUrls, setDiscoveredUrls] = useState<string[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
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
  const [aiEnabled, setAiEnabled] = useState(false);
  const [useAi, setUseAi] = useState(false);

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
      fetch("/api/ai/explain")
        .then((response) => response.json())
        .then((data: { enabled: boolean }) => setAiEnabled(data.enabled)),
    ]).catch(() => setError("The workbench could not load its saved data."));
  }, [loadPieces]);

  const runContentAudit = async (selectedUrls?: string[]) => {
    const input = selectedUrls ?? urls.split(/[\n,]+/).map((url) => url.trim()).filter(Boolean);
    if (!input.length) return setError("Paste at least one URL.");
    setRunning(true);
    setError("");
    try {
      for (let index = 0; index < input.length; index += 10) {
        const batch = input.slice(index, index + 10);
        setProgress(`Auditing ${Math.min(index + batch.length, input.length)} of ${input.length}`);
        const response = await fetch("/api/pieces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ urls: batch }),
        });
        const data = (await response.json()) as { items?: ContentPiece[]; error?: string };
        if (!response.ok || !data.items) throw new Error(data.error || "Audit failed.");
        setPieces((current) => {
          const next = [...current];
          data.items!.forEach((item) => {
            const existing = next.findIndex((piece) => piece.url === item.url);
            if (existing >= 0) next[existing] = item;
            else next.unshift(item);
          });
          return next;
        });
      }
      setUrls("");
      setDiscoveredUrls([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Audit failed.");
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const discoverSite = async () => {
    if (!site.trim()) return setError("Enter a website or sitemap URL.");
    setRunning(true);
    setError("");
    setProgress("Reading sitemap…");
    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site, max: maxPages }),
      });
      const data = (await response.json()) as { urls?: string[]; source?: string; error?: string };
      if (!response.ok || !data.urls) throw new Error(data.error || "Pages could not be found.");
      setDiscoveredUrls(data.urls);
      if (!data.urls.length) setError("No public content pages were found.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pages could not be found.");
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const removePiece = async (url: string) => {
    const response = await fetch("/api/pieces", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return setError("The page could not be removed.");
    setPieces((current) => current.filter((piece) => piece.url !== url));
  };

  const clearAll = async () => {
    if (!pieces.length || !window.confirm(`Clear all ${pieces.length} audited pages? Export first if you need a copy.`)) return;
    const response = await fetch("/api/pieces", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    if (!response.ok) return setError("The audit list could not be cleared.");
    setPieces([]);
    setOpen({});
  };

  const exportPages = () => download("content-audit-pages.csv", [
    ["url", "title", "funnel", "priority", "issues", "status", "owner", "words", "schema", "freshness"],
    ...filteredPieces.map((piece) => [piece.url, piece.title, piece.funnel, piece.priority, piece.issueCount, piece.fixStatus, piece.owner, piece.wordCount, piece.schemaTypes.join("; "), piece.freshnessDate]),
  ]);

  const exportFixes = () => download("content-audit-fixes.csv", [
    ["url", "title", "priority", "order", "fix", "discipline", "severity", "workflow", "status", "owner"],
    ...filteredPieces.flatMap((piece) => piece.consolidatedFixes.map((fix, index) => [piece.url, piece.title, piece.priority, index + 1, fix.fix, fix.discipline, fix.severity, fix.workflowId, piece.fixStatus, piece.owner])),
  ]);

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
          <button className={mode === "content" ? "active" : ""} onClick={() => setMode("content")}>Content + SEO</button>
          <button className={mode === "gsc" ? "active" : ""} onClick={() => setMode("gsc")}>GSC audit</button>
          <button className={mode === "brain" ? "active" : ""} onClick={() => setMode("brain")}>Workflow brain <em>{workflows.length || 46}</em></button>
        </nav>
        <span className={`aiStatus ${aiEnabled ? "ready" : ""}`}><i /> {aiEnabled ? "Cloudflare AI ready" : "AI optional"}</span>
      </header>

      <main className="workbench">
        {error && <div className="alert"><strong>Action needed</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}

        {mode === "content" && (
          <>
            <section className="auditPanel">
              <div className="panelTitle">
                <div><span>CONTENT + SEO INTELLIGENCE</span><h1>Audit a whole site</h1><p>Find every page, then combine technical SEO, intent, AEO, GEO, coverage, and freshness signals into one prioritized fix plan.</p></div>
                <span className="engineBadge"><i /> Engine online</span>
              </div>
              <div className="siteCommand">
                <label className="siteField"><span>Website or sitemap</span><input value={site} onChange={(event) => setSite(event.target.value)} placeholder="atlas.org or atlas.org/sitemap.xml" /></label>
                <label className="pageLimit"><span>Max pages</span><input type="number" min={1} max={200} value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))} /></label>
                <button className="secondaryButton findButton" disabled={running} onClick={() => void discoverSite()}>Find pages</button>
                <button className="runAudit" disabled={running || !discoveredUrls.length} onClick={() => void runContentAudit(discoveredUrls)}>
                  {running && progress.startsWith("Auditing") ? <><i className="spinner" /> {progress}</> : `Audit ${discoveredUrls.length ? discoveredUrls.length : "all"}`}
                </button>
                <label className="uploadButton">
                  <input type="file" accept=".csv,.txt,text/csv" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      const rows = parseCsv(await file.text());
                      const imported = rows.map((row) => String(row.url ?? row.page ?? "").trim()).filter(Boolean);
                      if (!imported.length) throw new Error("The CSV needs a URL column.");
                      setDiscoveredUrls(imported.slice(0, 200));
                      setError("");
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : "The URL CSV could not be read.");
                    }
                    event.target.value = "";
                  }} />
                  ⇧ Upload CSV
                </label>
                <button className="dangerButton" disabled={!pieces.length} onClick={() => void clearAll()}>Clear</button>
              </div>
              <div className="commandMeta">
                <button
                  type="button"
                  className={`aiToggle ${useAi ? "on" : ""}`}
                  aria-pressed={useAi}
                  disabled={!aiEnabled}
                  onClick={() => setUseAi((value) => !value)}
                >
                  <i />
                  <span><strong>AI explanations</strong><small>{aiEnabled ? (useAi ? "On · AI runs only when you click Explain" : "Off · no AI requests") : "Credentials not detected"}</small></span>
                </button>
                <button className="manualToggle" onClick={() => setManualOpen((value) => !value)}>{manualOpen ? "− Hide manual URLs" : "+ Or paste specific URLs"}</button>
                {discoveredUrls.length > 0 && <strong>{discoveredUrls.length} pages ready</strong>}
                {progress && !progress.startsWith("Auditing") && <em>{progress}</em>}
              </div>
              {manualOpen && (
                <div className="manualUrls">
                  <textarea value={urls} onChange={(event) => setUrls(event.target.value)} placeholder={"Paste one URL per line\nhttps://example.com/blog/best-crm"} />
                  <button className="runAudit" disabled={running || !urls.trim()} onClick={() => void runContentAudit()}>
                    {running ? <><i className="spinner" /> {progress || "Auditing…"}</> : "Audit pasted URLs"}
                  </button>
                </div>
              )}
              <div className="scopeNote"><strong>Evidence first.</strong> MASTER_BRAIN_V2 handles deterministic SEO and content checks. {useAi ? "Cloudflare AI is on for plain-language explanations." : "AI stays optional and never changes the rule outcome."}</div>
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
              <label className="toggleFilter"><input type="checkbox" checked={hideFixed} onChange={(event) => setHideFixed(event.target.checked)} /><i /> Hide fixed</label>
              <span />
              <button className="secondaryButton" disabled={!filteredPieces.length} onClick={exportPages}>↓ Pages CSV</button>
              <button className="secondaryButton" disabled={!filteredPieces.some((piece) => piece.consolidatedFixes.length)} onClick={exportFixes}>↓ Fixes CSV</button>
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
                        onDelete={() => void removePiece(piece.url)}
                        onWorkflow={openWorkflow}
                        aiEnabled={aiEnabled && useAi}
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
                <div className="gscActions">
                  <button className="secondaryButton" onClick={() => { setGscProperty("sc-domain:example.com"); setGscRows(GUIDED_GSC_DEMO); setGscFile("guided-demo.csv"); setError(""); }}>Load guided demo</button>
                  <button className="runAudit" disabled={running} onClick={() => void runGscAudit()}>{running ? "Running workflow brain…" : "▶ Run GSC audit"}</button>
                </div>
              </div>
              <div className="scopeNote">Required columns: <code>url</code> + <code>reason</code>. <a href="/sample-gsc-export.csv" download>Download the working template</a>.</div>
              {gscRows.length > 0 && (
                <div className="csvPreflight">
                  <span><strong>{gscRows.length}</strong> rows detected</span>
                  <span><strong>{Object.keys(gscRows[0]).length}</strong> columns mapped</span>
                  <span><strong>{gscRows.filter((row) => !row.url).length}</strong> missing URLs</span>
                  <span><strong>{gscRows.filter((row) => !row.reason && !row.workflow_id).length}</strong> missing reasons</span>
                </div>
              )}
              <div className={`aiStrip ${aiEnabled ? "ready" : ""}`}>
                <span>✦</span>
                <p><strong>Cloudflare AI explanation layer</strong><small>{aiEnabled ? "Ready to translate deterministic findings into plain-language action plans." : "Optional. Add server-side Cloudflare credentials to enable explanations; the rule engine works without AI."}</small></p>
                <em>{aiEnabled ? "READY" : "SAFE BY DEFAULT"}</em>
              </div>
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
                    <tbody>{gscAudit.findings.map((finding) => <GscFindingRows key={finding.id ?? `${finding.rowNumber}-${finding.url}`} finding={finding} aiEnabled={aiEnabled && useAi} onWorkflow={openWorkflow} />)}</tbody>
                  </table>
                </div>
              </>
            ) : <div className="empty secondaryEmpty"><span>⇧</span><strong>Your GSC findings will appear here</strong><p>Import the provided sample if you want to test the complete flow.</p></div>}
          </>
        )}

        {mode === "brain" && (
          <>
            <section className="brainHeader"><div><span>MASTER_BRAIN_V2.JSON</span><h1>One inspectable source of truth</h1><p>46 indexing, SEO, content, onboarding, and operations workflows. Click any row to inspect its decisions and outcomes.</p></div><strong>{workflows.length || 46}<small>workflows online</small></strong></section>
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
  onDelete,
  onWorkflow,
  aiEnabled,
}: {
  piece: ContentPiece;
  open: boolean;
  onToggle: () => void;
  onUpdate: (url: string, changes: { fixStatus?: ContentPiece["fixStatus"]; owner?: string; note?: string }) => Promise<void>;
  onReaudit: () => void;
  onDelete: () => void;
  onWorkflow: (id: string) => void;
  aiEnabled: boolean;
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
              <button className="dangerButton small" onClick={() => { if (window.confirm("Remove this page from the audit list?")) onDelete(); }}>Remove</button>
              {aiEnabled && <AiExplainButton
                enabled={aiEnabled}
                kind="content_piece"
                subject={{
                  url: piece.url,
                  title: piece.title,
                  priority: piece.priority,
                  pageSignals: {
                    statusCode: piece.statusCode,
                    wordCount: piece.wordCount,
                    schemaTypes: piece.schemaTypes,
                    freshnessDate: piece.freshnessDate,
                  },
                  issues: piece.issues.slice(0, 12),
                  deterministicFixes: piece.consolidatedFixes.slice(0, 8),
                }}
              />}
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

function GscFindingRows({
  finding,
  aiEnabled,
  onWorkflow,
}: {
  finding: Finding;
  aiEnabled: boolean;
  onWorkflow: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { explanation } = finding;
  return (
    <>
      <tr className="gscFindingRow" onClick={() => setOpen((value) => !value)}>
        <td><strong>{finding.url}</strong><small>Row {finding.rowNumber} · click for explanation</small></td>
        <td>{finding.reason}</td>
        <td><button className="workflowChip" onClick={(event) => { event.stopPropagation(); void onWorkflow(finding.workflowId); }}>{finding.workflowId}</button></td>
        <td><span className={`severity ${finding.severity}`}>{finding.severity}</span></td>
        <td><strong className="suggestionId">{finding.suggestionId}</strong><p>{finding.suggestion}</p>{finding.missingContext.length > 0 && <small>Missing: {finding.missingContext.join(" · ")}</small>}</td>
        <td><span className={`state ${finding.status === "evaluated" ? "done" : "review"}`}>{finding.status === "evaluated" ? "Resolved" : "Review"}</span></td>
      </tr>
      {open && (
        <tr className="gscExplainRow">
          <td colSpan={6}>
            <div className="explainIntro">
              <div>
                <span>Decision explanation</span>
                <h2>Here’s what happened—and what to do next.</h2>
              </div>
              <strong>Source · {explanation.source}</strong>
            </div>
            <div className="explainGrid">
              <section>
                <span>01 · Why this happened</span>
                <h3>{finding.reason} → {finding.workflowId}</h3>
                <p>{explanation.whyError}</p>
              </section>
              <section>
                <span>02 · Evidence used</span>
                <h3>{explanation.evidenceUsed.length ? `${explanation.evidenceUsed.length} signals checked` : "Reason label only"}</h3>
                {explanation.evidenceUsed.length ? (
                  <dl>{explanation.evidenceUsed.map(({ field, value }) => <div key={field}><dt>{field.replaceAll("_", " ")}</dt><dd>{value}</dd></div>)}</dl>
                ) : <p>No optional decision fields were present. The engine stopped before making assumptions.</p>}
              </section>
              <section>
                <span>03 · How to fix it</span>
                <h3>{finding.suggestionId}</h3>
                <p>{explanation.howToFix}</p>
              </section>
              <section className={finding.missingContext.length ? "needsContext" : ""}>
                <span>04 · How to verify</span>
                <h3>{finding.status === "evaluated" ? "Prove the fix worked" : "Collect context first"}</h3>
                <ul>{explanation.howToVerify.map((step) => <li key={step}>{step}</li>)}</ul>
                {finding.missingContext.length > 0 && <p className="missingEvidence">Still needed: {finding.missingContext.join(" · ")}</p>}
              </section>
            </div>
            <div className="decisionTrace">
              <div className="traceHeading"><span>MASTER_BRAIN decision path</span><strong>{explanation.decisionPath.length} steps</strong></div>
              {explanation.decisionPath.length ? (
                <ol>
                  {explanation.decisionPath.map((step, index) => (
                    <li key={`${step.nodeId}-${index}`}>
                      <i>{index + 1}</i>
                      <div><span>{step.type} · {step.nodeId}</span><strong>{step.label}</strong>{step.condition && <small>Branch: {step.condition}</small>}</div>
                    </li>
                  ))}
                </ol>
              ) : <p>This reason needs a workflow mapping before a decision path can be shown.</p>}
            </div>
            <div className="explainActions">
              <button className="secondaryButton" onClick={() => void onWorkflow(finding.workflowId)}>Inspect full workflow →</button>
              {aiEnabled && <AiExplainButton
                enabled={aiEnabled}
                kind="gsc_finding"
                subject={{
                  url: finding.url,
                  reason: finding.reason,
                  workflowId: finding.workflowId,
                  workflowTitle: finding.workflowTitle,
                  severity: finding.severity,
                  status: finding.status,
                  suggestionId: finding.suggestionId,
                  deterministicRecommendation: finding.suggestion,
                  deterministicExplanation: finding.explanation,
                  missingContext: finding.missingContext,
                }}
              />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AiExplainButton({
  enabled,
  kind,
  subject,
}: {
  enabled: boolean;
  kind: "content_piece" | "gsc_finding";
  subject: Record<string, unknown>;
}) {
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState("");
  const explain = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, subject }),
      });
      const data = (await response.json()) as { explanation?: string; error?: string };
      if (!response.ok || !data.explanation) throw new Error(data.error || "AI explanation failed.");
      setExplanation(data.explanation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI explanation failed.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="aiExplain">
      <button className="aiButton" disabled={loading || !enabled} onClick={() => void explain()}>
        {loading ? "✦ Explaining…" : enabled ? "✦ Explain with Cloudflare AI" : "✦ AI explanations off"}
      </button>
      {error && <div className="aiError">{error}</div>}
      {explanation && <div className="aiAnswer"><span>AI EXPLANATION · DETERMINISTIC RESULT PRESERVED</span><p>{explanation}</p></div>}
    </div>
  );
}

function WorkflowDrawer({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  return <div className="drawerBackdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={(event) => event.stopPropagation()}><button className="drawerClose" onClick={onClose}>×</button><span className="workflowChip large">{workflow.id}</span><small className="drawerCategory">{workflow.meta.category}</small><h2>{workflow.title}</h2><p>{workflow.structure}</p><div className="drawerStats"><span><strong>{workflow.nodes.length}</strong>nodes</span><span><strong>{workflow.edges.length}</strong>connections</span><span><strong>{workflow.meta.handoffs}</strong>handoffs</span></div><h3>Decision inputs</h3><ul>{workflow.clarifying.map((question) => <li key={question}>{question}</li>)}</ul><h3>Workflow nodes</h3><div className="nodes">{workflow.nodes.map((node) => <div className={node.type} key={node.id}><span>{node.type}</span><p>{node.label.replace(/^SUGGEST:\s*/i, "")}</p></div>)}</div></aside></div>;
}
