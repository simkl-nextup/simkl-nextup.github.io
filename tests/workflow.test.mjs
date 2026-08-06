import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/deploy.yml", import.meta.url);

test("deployment workflow retains the original GitHub Pages action sequence", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /jobs:\s*\n\s*refresh-and-deploy:/);
  assert.match(workflow, /environment:\s*\n\s*name: github-pages\s*\n\s*url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  assert.match(workflow, /uses: actions\/configure-pages@v5/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /id: deployment\s*\n\s*uses: actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /dispatch-pages|Queue both addons without polling|PAGES_ARTIFACT_ID/);
});
