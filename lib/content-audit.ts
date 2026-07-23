export type ContentIssue = {
  code: string;
  group: "AEO" | "GEO" | "TECH" | "FRESH";
  workflowId: string;
  symptom: string;
  rootCause: string;
  fix: string;
  discipline: string;
  handoff: string;
  severity: "gate" | "high" | "med" | "low";
  evidence?: Record<string, string | number | boolean>;
};

export type ContentPiece = {
  id?: string;
  url: string;
  finalUrl: string;
  title: string;
  funnel: "TOFU" | "MOFU" | "BOFU";
  statusCode: number;
  wordCount: number;
  schemaTypes: string[];
  freshnessDate: string | null;
  auditedAt: string;
  issues: ContentIssue[];
  issueCount: number;
  groupCounts: Record<string, number>;
  priority: "P0" | "P1" | "P2" | "P3" | "OK";
  consolidatedFixes: Array<Pick<ContentIssue, "fix" | "discipline" | "handoff" | "severity" | "workflowId">>;
  fixStatus: "To fix" | "In progress" | "Fixed";
  owner: string;
  notes: Array<{ ts: string; text: string }>;
  history: Array<{ ts: string; event: string; from?: string; to?: string; priority?: string; issues?: number }>;
  error?: string;
};

const PRIVATE_HOST = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

function safeUrl(value: string) {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withScheme);
  if (!["http:", "https:"].includes(url.protocol) || PRIVATE_HOST.test(url.hostname) || url.hostname.endsWith(".local")) {
    throw new Error("Only public http/https URLs can be audited.");
  }
  return url.toString();
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function stripTags(value: string) {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function matches(html: string, pattern: RegExp) {
  return [...html.matchAll(pattern)].map((match) => stripTags(match[1] ?? ""));
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1];
    if (found) return decodeEntities(found.trim());
  }
  return "";
}

function classifyFunnel(url: string, title: string): "TOFU" | "MOFU" | "BOFU" {
  const text = ` ${url} ${title} `.toLowerCase();
  if (["pricing", "price", "cost", "demo", "trial", "buy", "quote", " vs ", "review", "alternative"].some((term) => text.includes(term))) return "BOFU";
  if (["best ", "top ", "comparison", "compare", "how to choose", "roi", "use case"].some((term) => text.includes(term))) return "MOFU";
  return "TOFU";
}

function issue(
  code: string,
  group: ContentIssue["group"],
  workflowId: string,
  symptom: string,
  rootCause: string,
  fix: string,
  discipline: string,
  handoff: string,
  severity: ContentIssue["severity"],
  evidence?: ContentIssue["evidence"],
): ContentIssue {
  return { code, group, workflowId, symptom, rootCause, fix, discipline, handoff, severity, evidence };
}

export async function auditContentUrl(input: string): Promise<ContentPiece> {
  const url = safeUrl(input.trim());
  const auditedAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "SearchOps-Audit-Brain/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Page fetch failed";
    return emptyPiece(url, auditedAt, message);
  }

  const html = (await response.text()).slice(0, 2_000_000);
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || metaContent(html, "og:title") || url;
  const headings = [...matches(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi), ...matches(html, /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const paragraphs = matches(html, /<p\b[^>]*>([\s\S]*?)<\/p>/gi);
  const firstParagraph = paragraphs.find((paragraph) => paragraph.split(/\s+/).length >= 8) ?? "";
  const text = stripTags(html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const robots = metaContent(html, "robots").toLowerCase();
  const canonical = /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i.test(html);
  const schemaTypes = [...new Set([...html.matchAll(/"@type"\s*:\s*"([^"]+)"/gi)].map((match) => match[1].toLowerCase()))];
  const freshnessDate =
    metaContent(html, "article:modified_time").slice(0, 10) ||
    metaContent(html, "article:published_time").slice(0, 10) ||
    html.match(/"date(?:Modified|Published)"\s*:\s*"(\d{4}-\d{2}-\d{2})/i)?.[1] ||
    null;
  const funnel = classifyFunnel(url, title);
  const questionHeadings = headings.filter((heading) => /^(what|how|why|when|which|who|where|can|should|is|are|best|top|do|does)\b|\?$/i.test(heading)).length;
  const dataPoints = (text.slice(0, 12_000).match(/\b\d+(?:\.\d+)?(?:%| million| billion|x)?\b/gi) ?? []).length;
  const hasDefinition = /\b(is a|is an|refers to|is defined as|means|stands for)\b/i.test(text.slice(0, 900));
  const hasSynthesis = headings.some((heading) => /conclusion|summary|takeaway|final thought|bottom line|in short|tl;dr/i.test(heading));
  const hasFaq = schemaTypes.includes("faqpage") || headings.filter((heading) => /\?$/.test(heading)).length >= 3 || headings.some((heading) => /faq|frequently asked/i.test(heading));
  const tableCount = (html.match(/<table\b/gi) ?? []).length;
  const listCount = (html.match(/<(?:ol|ul)\b/gi) ?? []).length;
  const issues: ContentIssue[] = [];

  if (response.status >= 400) {
    issues.push(issue("TECH-STATUS", "TECH", response.status === 404 ? "R7" : "R9", "Page cannot be served or ranked", `HTTP ${response.status}`, "Restore the page, correct the status, or redirect it to the best replacement.", "Technical SEO", "R7/R9", "gate", { status: response.status }));
  } else if (robots.includes("noindex")) {
    issues.push(issue("TECH-NOINDEX", "TECH", "R4", "Page is blocked from the index", "Meta robots contains noindex", "Remove noindex if this page should rank, then request indexing.", "Technical SEO", "R4", "gate"));
  } else {
    if (wordCount < 200 && schemaTypes.length === 0) issues.push(issue("TECH-JSONLY", "TECH", "R17", "Little server-rendered content", `Only ${wordCount} words were present in the fetched HTML`, "Server-render or prerender the primary page content.", "Engineering", "R17", "high", { wordCount }));
    if (!canonical) issues.push(issue("TECH-CANON", "TECH", "R13", "No canonical tag", "Self-referencing canonical was not found", "Add a correct self-referencing canonical.", "Technical SEO", "R13", "low"));
    if (firstParagraph.split(/\s+/).length < 15) issues.push(issue("AEO-ANSWER", "AEO", "CA4", "No clear answer up top", "No substantive answer-first opening was found", "Add a direct 2–3 sentence answer before the first major section.", "Content", "CA4", "high"));
    if (!hasDefinition) issues.push(issue("AEO-DEF", "AEO", "CA4", "Key terms are not defined early", "No definitional phrasing in the opening", "Define the core entity or concept at first use.", "Content", "CA4", "low"));
    if (questionHeadings === 0 && headings.length >= 2) issues.push(issue("AEO-QHEAD", "AEO", "CA4", "Headings do not mirror real questions", "No question-form H2/H3 headings", "Rewrite the highest-value headings as reader questions.", "Content", "CA4", "med"));
    if (funnel === "MOFU" && tableCount === 0) issues.push(issue("AEO-TABLE", "AEO", "CA4", "Evaluation page has no comparison table", "No table was found on a comparison-oriented page", "Add an options × criteria comparison table.", "Content", "CA4", "med"));
    if (dataPoints < 5) issues.push(issue("AEO-DATA", "AEO", "CA4", "Thin on specific evidence", `Only ${dataPoints} numeric signals were found`, "Add dated statistics, figures, benchmarks, or examples.", "Content", "CA4", "med", { dataPoints }));
    if (listCount === 0) issues.push(issue("AEO-LIST", "AEO", "CA4", "Processes are not structured", "No ordered or unordered lists were found", "Convert sequential or grouped information into clear lists.", "Content", "CA4", "low"));
    if (!hasSynthesis) issues.push(issue("AEO-SYNTH", "AEO", "CA4", "No closing synthesis", "No conclusion, summary, or takeaway section", "End with a concise synthesis and next step.", "Content", "CA4", "low"));
    if (!hasFaq) issues.push(issue("AEO-FAQ", "AEO", "CA4", "Implied follow-up questions are missing", "No FAQ or follow-up question coverage", "Add a short FAQ that resolves the next questions readers ask.", "Content", "CA4", "low"));
    if (!schemaTypes.some((type) => ["organization", "corporation", "website"].includes(type))) issues.push(issue("GEO-SITESCHEMA", "GEO", "CA6", "Missing sitewide entity schema", "Organization or WebSite JSON-LD was not found", "Add Organization and WebSite schema with consistent entity details.", "Tech + Content", "CA6", "med"));
    if (!schemaTypes.some((type) => ["article", "faqpage", "product", "service", "howto", "blogposting", "newsarticle"].includes(type))) issues.push(issue("GEO-PAGESCHEMA", "GEO", "CA6", "Missing page-type schema", "No Article, FAQPage, Product, Service, or HowTo JSON-LD was found", "Add the schema type that accurately describes this page.", "Tech + Content", "CA6", "high"));
    if (!freshnessDate) issues.push(issue("FRESH-NODATE", "FRESH", "CA7", "No freshness date is exposed", "Published or modified date was not found in markup", "Expose a visible and structured last-updated date.", "Content", "CA7", "low"));
    if (freshnessDate) {
      const age = Math.floor((Date.now() - new Date(freshnessDate).getTime()) / 86_400_000);
      if (age > 540) issues.push(issue("FRESH-STALE", "FRESH", "CA7", "Content appears stale", `The exposed date is ${age} days old`, "Refresh the examples, claims, links, and date.", "Content", "CA7", "med", { ageDays: age }));
    }
    if (wordCount < 400) issues.push(issue("FRESH-THIN", "FRESH", "CA5", "Thin topical coverage", `Only ${wordCount} words were found`, "Expand the page to cover the full intent and important subtopics.", "Content", "CA5", "med", { wordCount }));
  }

  const groupCounts = issues.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.group] = (counts[finding.group] ?? 0) + 1;
    return counts;
  }, {});
  const priority = priorityFor(issues);
  const uniqueFixes = new Map<string, ContentPiece["consolidatedFixes"][number]>();
  for (const finding of issues) {
    if (!uniqueFixes.has(finding.fix)) {
      uniqueFixes.set(finding.fix, {
        fix: finding.fix,
        discipline: finding.discipline,
        handoff: finding.handoff,
        severity: finding.severity,
        workflowId: finding.workflowId,
      });
    }
  }

  return {
    url,
    finalUrl: response.url || url,
    title,
    funnel,
    statusCode: response.status,
    wordCount,
    schemaTypes,
    freshnessDate,
    auditedAt,
    issues,
    issueCount: issues.length,
    groupCounts,
    priority,
    consolidatedFixes: [...uniqueFixes.values()].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity)),
    fixStatus: "To fix",
    owner: "",
    notes: [],
    history: [],
  };
}

function severityWeight(value: ContentIssue["severity"]) {
  return { gate: 100, high: 8, med: 4, low: 2 }[value];
}

function priorityFor(issues: ContentIssue[]): ContentPiece["priority"] {
  if (!issues.length) return "OK";
  if (issues.some((finding) => finding.severity === "gate")) return "P0";
  if (issues.some((finding) => finding.severity === "high")) return "P1";
  if (issues.some((finding) => finding.severity === "med")) return "P2";
  return "P3";
}

function emptyPiece(url: string, auditedAt: string, error: string): ContentPiece {
  return {
    url,
    finalUrl: url,
    title: url,
    funnel: "TOFU",
    statusCode: 0,
    wordCount: 0,
    schemaTypes: [],
    freshnessDate: null,
    auditedAt,
    issues: [],
    issueCount: 0,
    groupCounts: {},
    priority: "P0",
    consolidatedFixes: [],
    fixStatus: "To fix",
    owner: "",
    notes: [],
    history: [],
    error,
  };
}
