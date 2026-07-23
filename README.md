# SearchOps Workbench

A deployable content and Google Search Console operations workbench powered by
the supplied `MASTER_BRAIN.json`.

## What works

- Fetches and audits live public URLs from the dashboard.
- Discovers up to 200 same-site pages from nested sitemaps, with a safe
  homepage-link fallback.
- Imports URL lists from CSV and audits large lists in controlled batches.
- Groups AEO, GEO, technical, and freshness issues per content piece.
- Stores owner, status, notes, audit history, evidence, and a consolidated fix
  plan for each page.
- Imports a GSC CSV export from the dashboard.
- Shows a CSV preflight before processing.
- Matches indexing reasons to R1–R27 workflow paths.
- Uses only evidence present in the export; incomplete rows are marked
  `needs_context`.
- Expands every GSC finding into: why it matched, evidence used, workflow
  outcome, and confidence gate.
- Stores audits, source rows, matches, severity, and recommendations in
  Cloudflare D1.
- Reopens previous audits from history.
- Filters and exports findings as CSV.
- Exports page summaries and ordered fix lists as separate CSV files.
- Supports individual removal, clear-all, and one-click re-audits.
- Exposes all 46 indexing, content, onboarding, and operations workflows in an
  inspectable workflow library.

## CSV format

Required columns:

```csv
url,reason
https://example.com/missing,Not found (404)
```

Useful optional columns include:

- `last_crawl_time`
- `in_sitemap`
- `clicks`
- `impressions`
- `robots_txt_state`
- `indexing_state`
- `referring_urls`
- `pattern`
- `target_indexed`
- `page_fetch_state`

The dashboard includes a working sample and a downloadable CSV template.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Verify

```bash
npm run db:generate
npm test
```

## Deploy

The app is Cloudflare Worker compatible. `.openai/hosting.json` declares the
logical D1 binding. The Sites deployment workflow creates and wires the actual
database.

## Future GSC API connection

The import and workflow layers are intentionally separate. A Google OAuth +
Search Console connector can later submit the same normalized row objects to
`POST /api/audits` without replacing the dashboard, rules engine, or storage
model.

## Optional Cloudflare AI explanations

The deterministic workflow engine remains the source of truth. Cloudflare
Workers AI can optionally translate an existing finding into a short
plain-language explanation; it cannot change the workflow, severity, evidence,
or recommendation.

The dashboard switch controls whether AI actions are shown. Switching it on
does not spend an inference request by itself; a request is sent only when the
operator clicks **Explain with Cloudflare AI**. Responses are checked for
numeric claims that do not exist in the deterministic payload. Unsupported
answers are blocked instead of displayed.

Copy the local Cloudflare runtime template:

```bash
cp .dev.vars.example .dev.vars
```

Set these values in `.dev.vars`:

```env
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-workers-ai-token
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
```

Create the token from Cloudflare **Workers AI → Use REST API**. Keep the token
server-side; never put it in browser code or commit `.dev.vars`.

Cloudflare Workers AI documentation:

- https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
