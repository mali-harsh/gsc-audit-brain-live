import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the finished SearchOps Workbench", async () => {
  const [dashboard, layout, page, brainSource] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../data/master-brain-v2.json", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);
  const brain = JSON.parse(brainSource);

  assert.match(layout, /SearchOps Workbench/);
  assert.match(dashboard, /Content \+ SEO/);
  assert.match(dashboard, /MASTER_BRAIN_V2/);
  assert.match(dashboard, /Audit a whole site/);
  assert.match(dashboard, /Find pages/);
  assert.match(dashboard, /Upload CSV/);
  assert.match(dashboard, /Pages CSV/);
  assert.match(dashboard, /Audit each page\. Fix each piece once/);
  assert.match(dashboard, /Engine online/);
  assert.match(dashboard, /GSC audit/);
  assert.match(dashboard, /Workflow brain/);
  assert.match(page, /<Dashboard \/>/);
  assert.equal(brain.length, 46);
  assert.equal(brain.find((workflow) => workflow.id === "CA4")?.meta.category, "Content / GEO-AEO structure");
  assert.equal(brain.find((workflow) => workflow.id === "CA6")?.meta.category, "GEO / AI search");
  assert.doesNotMatch(`${dashboard}\n${layout}\n${page}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
