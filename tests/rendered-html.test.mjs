import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the finished SearchOps Workbench", async () => {
  const [dashboard, layout, page] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(layout, /SearchOps Workbench/);
  assert.match(dashboard, /Audit a whole site/);
  assert.match(dashboard, /Find pages/);
  assert.match(dashboard, /Upload CSV/);
  assert.match(dashboard, /Pages CSV/);
  assert.match(dashboard, /Audit each page\. Fix each piece once/);
  assert.match(dashboard, /Engine online/);
  assert.match(dashboard, /GSC audit/);
  assert.match(dashboard, /Workflow brain/);
  assert.match(page, /<Dashboard \/>/);
  assert.doesNotMatch(`${dashboard}\n${layout}\n${page}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
