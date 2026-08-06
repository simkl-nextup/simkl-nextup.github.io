import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSite } from "../src/site.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveRepoPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.join(root, value);
}

await writeSite({
  outputDir: resolveRepoPath(process.env.SIMKL_PROFILE_OUTPUT_DIR, path.join(root, "public")),
  catalog: { metas: [] },
  items: {},
  updatedAt: "Not connected yet",
  skipped: [],
  baseUrl: "",
  addonId: process.env.SIMKL_PROFILE_ADDON_ID,
  addonName: process.env.SIMKL_PROFILE_ADDON_NAME,
  catalogId: process.env.SIMKL_PROFILE_CATALOG_ID,
  catalogName: process.env.SIMKL_PROFILE_CATALOG_NAME,
  setupSecretName: process.env.SIMKL_PROFILE_SECRET_NAME,
  pageHeading: process.env.SIMKL_PROFILE_PAGE_HEADING,
  setupDocumentTitle: process.env.SIMKL_PROFILE_SETUP_TITLE,
  setupHeading: process.env.SIMKL_PROFILE_SETUP_HEADING,
});
console.log("Built placeholder site.");
